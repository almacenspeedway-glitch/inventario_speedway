import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { InventoryStore } from '../lib/store.ts';
import { extractCodes, exactMatches, validateCode } from '../lib/identification.ts';
import { requireLocal } from '../lib/local.ts';
import type { Actor, MovementInput, Product, SourceRecord } from '../lib/types.ts';
const supervisor:Actor={id:'sup',role:'supervisor'};
const operator:Actor={id:'op',role:'operario'};
const source={sha256:'fixture',fileName:'WhatsApp_chat_entrenamiento.zip'};
const record=(id:string,body='001234567890 una unidad para stock'):SourceRecord=>({id,text:body,timestamp:'2026-10-08T13:12:13-05:00',author:'Entrenamiento',photos:[],candidate:true,kind:'conteo_probable',quantity:1,lot:null,expiry:{raw:null,iso:null,precision:null,issue:null}});
function seed(db:InventoryStore) { db.importRecords(Array.from({length:10},(_,i)=>record(String(i))),source); }
function save(db:InventoryStore,eventId:string,productId:string,quantity:number,kind:MovementInput['kind']='entrada',actor=supervisor,lot='',expiry='') {
  return db.saveReview({eventId,productId,quantity,kind,lot,expiry,notes:'Verificado con evidencia de prueba',version:db.review(eventId)?.version||0},actor);
}
test('códigos preservan ceros; excluyen adjuntos, enlaces y fechas; tipo no adivinado',()=>{
  assert.deepEqual(extractCodes('001234567890 una unidad <adjunto: 00003028-PHOTO-2026-10-08.jpg> https://x.test/9988776655 Vence 08/28'),[{value:'001234567890',kind:'desconocido',origin:'mensaje'}]);
  assert.equal(extractCodes('SKU: AB-00123 referencia 987654321')[0].value,'AB-00123');
  assert.equal(extractCodes('referencia 987654321')[0].kind,'referencia');
  assert.throws(()=>validateCode(123456));
});
test('código ambiguo conserva todas las coincidencias; nombre parecido no identifica',()=>{
  const products=['a','b'].map(id=>({id,name:'Producto parecido',status:'identificado',merged_into:null,effi_id:null,codes:[{value:'0007',kind:'SKU',origin:'supervisor'}]})) as Product[];
  assert.equal(exactMatches([{value:'0007',kind:'desconocido',origin:'mensaje'}],products).length,2);
  assert.equal(exactMatches([{value:'0008',kind:'SKU',origin:'mensaje'}],products).length,0);
  assert.equal(exactMatches([{value:'0007',kind:'referencia',origin:'mensaje'}],products).length,0);
});
test('reimportar no duplica y cambios en evidencia se rechazan atómicamente',()=>{
  const db=new InventoryStore(':memory:');
  assert.equal(db.importRecords([record('a')],source).inserted,1);
  assert.equal(db.importRecords([record('a')],source).inserted,0);
  const reordered=Object.fromEntries(Object.entries(record('a')).reverse()) as SourceRecord;
  assert.equal(db.importRecords([reordered],source).inserted,0);
  assert.throws(()=>db.importRecords([record('b'),record('a','texto alterado')],source),/cambió/);
  assert.throws(()=>db.record('b'),/no encontrado/);
  assert.throws(()=>db.importRecords([],source,'inicial'),/entrenamiento/);
  db.close();
});
test('registro sin código mantiene identidad propia y repetir alta no crea otra ficha',()=>{
  const db=new InventoryStore(':memory:');db.importRecords([record('a','foto'),record('b','foto')],source);
  const a=db.createProvisional('a',supervisor); const b=db.createProvisional('b',supervisor);
  assert.notEqual(a.id,b.id);assert.equal(db.createProvisional('a',supervisor).id,a.id);assert.equal(db.balance(a.id),0);db.close();
});
test('confirmación idempotente y físico provisional excluido del disponible',()=>{
  const db=new InventoryStore(':memory:');seed(db);const p=db.createProvisional('0',supervisor);
  const r=save(db,'0',p.id,5,'apertura');db.confirm('0',r.version,supervisor);db.confirm('0',r.version,supervisor);
  const product=db.products()[0];assert.equal(product.physical,5);assert.equal(product.provisional,5);assert.equal(product.available,0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM movements').get()?.n,1);db.close();
});
test('identificar y enlazar conserva total y mantiene historial inmutable',()=>{
  const db=new InventoryStore(':memory:');seed(db);const a=db.createProvisional('0',supervisor);const b=db.createProvisional('1',supervisor);
  for(const [event,id,qty] of [['0',a.id,5],['1',b.id,2]] as const){const r=save(db,event,id,qty);db.confirm(event,r.version,supervisor);}
  db.identify(b.id,'Producto verificado 500 g',[{value:'0001',kind:'SKU',origin:'supervisor'}],'EFFI-1',supervisor);
  const before=JSON.stringify(db.db.prepare('SELECT * FROM movements').all());
  db.merge(a.id,b.id,'Coincidencia de código y presentación',supervisor);
  assert.equal(db.balance(b.id),7);assert.equal(db.products().reduce((s,p)=>s+(p.physical||0),0),7);
  assert.equal(db.products().find(p=>p.id===b.id)?.available,7);
  assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM movements').all()),before);
  assert.throws(()=>db.db.exec('UPDATE movements SET delta=999'),/inmutable/);db.close();
});
test('operario solo confirma movimientos propios identificados; supervisor controla provisional y ajustes',()=>{
  const db=new InventoryStore(':memory:');seed(db);assert.throws(()=>db.createProvisional('0',operator),/supervisor/);
  const p=db.createProvisional('0',supervisor);let r=save(db,'1',p.id,4,'entrada',operator);
  assert.throws(()=>db.confirm('1',r.version,operator),/supervisor/);
  db.identify(p.id,'Producto verificado',[],null,supervisor);db.confirm('1',r.version,operator);
  r=save(db,'2',p.id,1,'salida',operator);assert.throws(()=>db.confirm('2',r.version,{id:'otro',role:'operario'}),/supervisor/);db.confirm('2',r.version,operator);
  r=save(db,'3',p.id,9,'conteo',operator);assert.throws(()=>db.confirm('3',r.version,operator),/supervisor/);
  assert.throws(()=>db.identify(p.id,'Otro',[],null,operator),/supervisor/);assert.equal(db.balance(p.id),3);db.close();
});
test('conteo fija saldo, apertura duplicada se bloquea y no se permite salida sin lote correcto',()=>{
  const db=new InventoryStore(':memory:');seed(db);const p=db.createProvisional('0',supervisor);
  let r=save(db,'0',p.id,5,'apertura',supervisor,'L1','2028-08');db.confirm('0',r.version,supervisor);
  r=save(db,'1',p.id,3,'conteo',supervisor,'L1','2028-08');db.confirm('1',r.version,supervisor);assert.equal(db.balance(p.id),3);
  r=save(db,'2',p.id,2,'apertura');assert.throws(()=>db.confirm('2',r.version,supervisor),/apertura/);
  r=save(db,'3',p.id,1,'salida');assert.throws(()=>db.confirm('3',r.version,supervisor),/insuficiente/);db.close();
});
test('versiones impiden sobrescribir, cantidades y vencimientos se validan',()=>{
  const db=new InventoryStore(':memory:');seed(db);const p=db.createProvisional('0',supervisor);save(db,'0',p.id,2);
  assert.throws(()=>db.saveReview({eventId:'0',productId:p.id,quantity:9,kind:'entrada',lot:'',expiry:'',notes:'',version:1},supervisor),/Otra revisión/);
  assert.throws(()=>save(db,'1',p.id,-1),/Cantidad/);assert.throws(()=>save(db,'1',p.id,1.2),/Cantidad/);
  assert.throws(()=>save(db,'1',p.id,1,'entrada',supervisor,'','2028-99'),/vencimiento/);db.close();
});
test('no se guarda mapeo contradictorio ni se usan códigos sin validar como equivalencia',()=>{
  const db=new InventoryStore(':memory:');seed(db);const a=db.createProvisional('0',supervisor);const b=db.createProvisional('1',supervisor);
  db.identify(a.id,'Producto A',[{value:'0001',kind:'SKU',origin:'supervisor'}],null,supervisor);
  assert.throws(()=>db.identify(b.id,'Producto B',[{value:'0001',kind:'EAN',origin:'supervisor'}],null,supervisor),/otro producto/);
  assert.equal(db.snapshot(source,{},[]).records[0].matches.length,0);db.close();
});
test('validar un EAN rotulado en el mensaje lo convierte en correspondencia reutilizable',()=>{
  const db=new InventoryStore(':memory:');db.importRecords([record('a','EAN: 001234567890 una unidad'),record('b','001234567890 una unidad')],source);
  const p=db.createProvisional('a',supervisor);
  db.identify(p.id,'Producto verificado',[{value:'001234567890',kind:'EAN',origin:'supervisor'}],null,supervisor);
  assert.equal(db.snapshot(source,{},[]).records.find(r=>r.id==='b')?.matches[0]?.id,p.id);
  db.close();
});
test('persistencia al cerrar y reabrir',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'speedway-persist-'));const file=path.join(dir,'test.sqlite');
  let db=new InventoryStore(file);seed(db);const p=db.createProvisional('0',supervisor);db.close();db=new InventoryStore(file);assert.equal(db.product(p.id).id,p.id);db.close();rmSync(dir,{recursive:true});
});
test('dos salidas simultáneas en conexiones independientes no producen negativo',{timeout:15000},async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'speedway-race-'));const file=path.join(dir,'test.sqlite');
  const db=new InventoryStore(file);seed(db);const p=db.createProvisional('0',supervisor);let r=save(db,'0',p.id,1);db.confirm('0',r.version,supervisor);
  const reviews=['1','2'].map(id=>save(db,id,p.id,1,'salida'));
  const workers=reviews.map(r=>new Worker(new URL('./exit-worker.ts',import.meta.url),{workerData:{file,eventId:r.event_id,version:r.version},execArgv:['--experimental-strip-types']}));
  const exits=workers.map(w=>new Promise<void>(resolve=>w.once('exit',()=>resolve())));
  await Promise.all(workers.map(w=>new Promise<void>((resolve,reject)=>{w.once('message',()=>resolve());w.once('error',reject);})));
  const results=await Promise.all(workers.map(w=>new Promise<{ok:boolean;error?:string}>((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);w.postMessage('go');})));
  await Promise.all(exits);
  assert.equal(results.filter(r=>r.ok).length,1);assert.match(results.find(r=>!r.ok)!.error!,/insuficiente/);assert.equal(db.balance(p.id),0);db.close();rmSync(dir,{recursive:true});
});
test('fuente real de entrenamiento: 724 mensajes, 541 fotos y 54 candidatos con códigos',{skip:!existsSync(path.resolve('../work/importaciones/entrenamiento-revision.json'))},()=>{
  const sourceData=JSON.parse(readFileSync(path.resolve('../work/importaciones/entrenamiento-revision.json'),'utf8'));
  assert.equal(sourceData.records.length,724);assert.equal(sourceData.summary.linkedPhotoMessages,541);
  assert.equal(sourceData.records.filter((r:SourceRecord)=>r.candidate&&extractCodes(r.text).length).length,54);
  const sample=sourceData.records.find((r:SourceRecord)=>r.id==='6f139ca01e4fde96');assert.equal(sample.photos[0],'00003028-PHOTO-2026-10-08-13-12-13.jpg');
});
test('laboratorio rechaza nube, hosts externos y escrituras de otro origen',()=>{
  const old=process.env.SPEEDWAY_LOCAL_LAB;process.env.SPEEDWAY_LOCAL_LAB='1';
  assert.throws(()=>requireLocal(new Request('https://example.com/api/lab')),/desactivado/);
  assert.throws(()=>requireLocal(new Request('http://localhost:4174/api/lab',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'}})),/Origen/);
  requireLocal(new Request('http://localhost:4174/api/lab',{method:'POST',headers:{origin:'http://localhost:4174','content-type':'application/json'}}));
  requireLocal(new Request('http://localhost:4174/api/lab',{method:'POST',headers:{host:'127.0.0.1:4174',origin:'http://127.0.0.1:4174','content-type':'application/json'}}));
  assert.throws(()=>requireLocal(new Request('http://localhost:4174/api/lab',{headers:{host:'evil.test:4174'}})),/Host/);
  process.env.SPEEDWAY_LOCAL_LAB=old;
});
