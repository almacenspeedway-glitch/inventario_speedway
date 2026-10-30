'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../lib/types';
import RecordDetail from './record-detail';
import Catalog from './catalog';
export type Mutate = (body: Record<string,unknown>, success: string) => Promise<boolean>;
const date = (value:string) => new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toLocaleString('es-CO',{timeZone:'America/Bogota',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

export default function Lab() {
  const [data,setData]=useState<Snapshot|null>(null);
  const [view,setView]=useState('laboratorio');
  const [selected,setSelected]=useState('6f139ca01e4fde96');
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('todos');
  const [page,setPage]=useState(0);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function reload() {
    const response=await fetch('/api/lab',{cache:'no-store'});
    const body=await response.json();
    if(!response.ok) throw new Error(body.error);
    setData(body);
  }
  useEffect(()=>{reload().catch(e=>setError(e.message));},[]);
  const mutate:Mutate=async(body,success)=>{
    if(busy) return false;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch('/api/lab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error);
      await reload();setNotice(success);return true;
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo completar la acción.');return false;}
    finally {setBusy(false);}
  };
  const filtered=useMemo(()=>data?.records.filter(r=>{
    if(filter==='sin_cantidad' && r.quantity!==null) return false;
    if(filter==='con_codigo' && !r.codes.length) return false;
    if(filter==='sugerencia' && !r.suggestion) return false;
    if(filter==='confirmados' && r.review?.status!=='confirmado') return false;
    const product=data.products.find(p=>p.id===r.review?.product_id);
    return [r.text,r.id,r.author,r.suggestion?.productoSugerido,product?.name,...r.codes.map(c=>c.value)].join(' ').toLowerCase().includes(query.toLowerCase());
  })||[],[data,filter,query]);
  const record=data?.records.find(r=>r.id===selected);
  const activeProducts=data?.products.filter(p=>!p.merged_into)||[];
  const stats=[['Registros por revisar',data?.records.filter(r=>r.review?.status!=='confirmado').length??'—'],['Mensajes con foto',data?.summary.linkedPhotoMessages??'—'],['Con códigos en texto',data?.records.filter(r=>r.codes.length).length??'—'],['Físico provisional',activeProducts.reduce((a,p)=>a+(p.provisional||0),0)]];
  return <div className="shell">
    <aside className="sidebar"><a href="/" className="brand"><span className="brand-mark">S<span>↗</span></span><strong>SPEEDWAY<small>INVENTARIO</small></strong></a>
      <div className="workspace-label">ESPACIO DE TRABAJO</div><div className="warehouse">▦ <span>Bodega principal<small>Speedway · saldo común</small></span></div>
      <nav aria-label="Principal">{[['laboratorio','▧','Laboratorio'],['catalogo','▦','Catálogo y pendientes'],['historial','↗','Movimientos'],['fuente','◉','Fuente y avance']].map(([id,icon,label])=><button key={id} onClick={()=>setView(id)} className={view===id?'nav active':'nav'}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebar-footer"><span className="dot"/> Entrenamiento<small>Una fuente activa<br/>WhatsApp con fotos</small></div>
    </aside>
    <main><header className="topbar"><span>Speedway <span className="muted">/ Inventario físico</span></span><span className="pill">LABORATORIO LOCAL</span></header>
      <div className="page"><div className="heading"><div><p className="eyebrow">ENTREGA 01 / ENTRENAMIENTO</p><h1>{view==='laboratorio'?'Del mensaje al inventario.':view==='catalogo'?'Cada producto, una identidad.':view==='historial'?'Movimientos con evidencia.':'Una base para avanzar.'}</h1><p className="subtitle">{view==='laboratorio'?'Revisa la foto, conserva el código y decide con evidencia.':view==='catalogo'?'Resuelve pendientes sin volver a sumar las unidades.':'Todo bajo Speedway, con un saldo físico común por bodega.'}</p></div><span className="source-chip">● WhatsApp · entrenamiento</span></div>
      <div className="training-note"><strong>Estás probando como supervisor.</strong> El guardado es local y solo afecta saldos de entrenamiento. Los usuarios reales y la nube aún no están activados.</div>
      {error&&<div className="message error" role="alert">{error}</div>}{notice&&<div className="message success" role="status">{notice}</div>}
      {!data?<div className="empty">{error?'Revisa la importación y vuelve a cargar.':'Abriendo fotos, mensajes y revisiones…'}</div>:<>
        <div className="stats">{stats.map(([label,value])=><div className="stat" key={label}><span>{label}</span><strong>{value}</strong><small>{label==='Físico provisional'?'Unidades aprobadas, fuera del disponible':'Chat de entrenamiento'}</small></div>)}</div>
        {view==='laboratorio'&&<div className="lab-grid"><section className="record-panel"><div className="panel-title"><h2>Bandeja de revisión</h2><span>{filtered.length}</span></div><label className="sr-only" htmlFor="search">Buscar registro</label><input id="search" className="search" placeholder="Buscar nombre, código o mensaje…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/><label className="sr-only" htmlFor="filter">Filtrar registros</label><select id="filter" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="todos">Todos los registros</option><option value="con_codigo">Con código en el mensaje</option><option value="sugerencia">Con sugerencia visual</option><option value="sin_cantidad">Sin cantidad escrita</option><option value="confirmados">Confirmados en entrenamiento</option></select>
          <div className="record-list">{filtered.slice(page*10,page*10+10).map(r=><button className={`record-row ${selected===r.id?'selected':''}`} key={r.id} onClick={()=>setSelected(r.id)}><span className="record-top"><span>{date(r.timestamp)}</span><span className={`badge ${r.review?.status==='confirmado'?'green':''}`}>{r.review?.status==='confirmado'?'Confirmado':r.review?'Borrador':'Pendiente'}</span></span><strong>{r.suggestion?.productoSugerido || (r.codes.length?`Código ${r.codes[0].value}`:'Producto por identificar')}</strong><span className="snippet">{r.text.replace(/<adjunto:[^>]+>/g,'').trim()||'Foto sin descripción escrita'}</span><span className="record-bottom">{r.photos.length?'▧ Foto vinculada':'Sin foto'} <span>{r.quantity===null?'Cantidad pendiente':`${r.quantity} unidades`}</span></span></button>)}{!filtered.length&&<p className="empty">No hay coincidencias.</p>}</div>
          <div className="pagination"><button disabled={page===0} onClick={()=>setPage(page-1)}>←</button><span>{page+1} / {Math.max(1,Math.ceil(filtered.length/10))}</span><button disabled={(page+1)*10>=filtered.length} onClick={()=>setPage(page+1)}>→</button></div>
        </section>{record&&<RecordDetail key={`${record.id}-${record.review?.version||0}`} record={record} products={activeProducts} mutate={mutate} busy={busy}/>}</div>}
        {view==='catalogo'&&<Catalog products={activeProducts} mutate={mutate} busy={busy}/>}
        {view==='historial'&&<section className="card"><div className="panel-title"><h2>Movimientos confirmados</h2><span>{data.movements.length}</span></div><p className="muted">Disponible de entrenamiento: {activeProducts.reduce((a,p)=>a+(p.available||0),0)} unidades · Provisional: {stats[3][1]} unidades</p>{!data.movements.length?<div className="empty">Todavía no hay movimientos. Los mensajes importados no se suman automáticamente.</div>:<div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Lote / vence</th><th>Cambio</th><th>Origen</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}><td>{date(m.created_at)}</td><td>{data.products.find(p=>p.id===m.product_id)?.name}</td><td>{m.kind}</td><td>{m.lot||'Sin lote'} / {m.expiry||'Sin fecha'}</td><td className={m.delta<0?'negative':'positive'}>{m.delta>0?'+':''}{m.delta}</td><td><button className="link" onClick={()=>{setSelected(m.event_id);setView('laboratorio');}}>Ver mensaje</button></td></tr>)}</tbody></table></div>}<h3>Auditoría reciente</h3><div className="audit">{data.audit.slice(0,20).map((a,i)=><details key={i}><summary>{date(a.created_at)} · {a.action} · {a.actor}</summary><pre>{a.detail}</pre></details>)}</div></section>}
        {view==='fuente'&&<section className="card source"><h2>Única fuente activa</h2><p><strong>{String(data.source.fileName)}</strong></p><p>{data.summary.messages} mensajes · {data.summary.attachmentMatches} adjuntos encontrados · {data.summary.attachmentMissing} adjuntos ausentes</p><p>Las fotos se vinculan por el nombre exacto escrito en el mensaje. Los códigos se conservan como texto y las sugerencias requieren revisión.</p><h3>Cómo avanza el sistema</h3><ol><li><strong>Disponible:</strong> ficha visual, borradores, catálogo provisional, saldos e historial local de entrenamiento.</li><li><strong>Siguiente conexión:</strong> Supabase, usuarios reales y fotos privadas.</li><li><strong>Después:</strong> Telegram y n8n con confirmación del operario.</li><li><strong>Effi:</strong> catálogo verificado y comparación de saldos, sin ajustes automáticos.</li><li><strong>Operación real:</strong> importación del archivo real y apertura aprobada por supervisor.</li></ol><h3>Identificación responsable</h3><p>Un número puede ser EAN, SKU o referencia. Una foto propone; la persona valida. Un conteo fija un saldo para el lote indicado: no equivale a una entrada.</p></section>}
      </>}
      </div></main>
  </div>;
}
