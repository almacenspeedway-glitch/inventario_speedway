import { parentPort,workerData } from 'node:worker_threads';
import { InventoryStore } from '../lib/store.ts';
const db=new InventoryStore(workerData.file);
parentPort!.once('message',()=>{
  try {db.confirm(workerData.eventId,workerData.version,{id:'sup',role:'supervisor'});parentPort!.postMessage({ok:true});}
  catch(e){parentPort!.postMessage({ok:false,error:(e as Error).message});}
  finally {db.close();parentPort!.close();}
});
parentPort!.postMessage('ready');
