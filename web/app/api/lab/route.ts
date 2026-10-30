import { requireLocal, getStore, sourceData, suggestions } from '../../../lib/local';
import type { Actor, Code, MovementInput } from '../../../lib/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const actor: Actor = {id:'supervisor-local-entrenamiento',role:'supervisor'};
const json = (data: unknown, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request: Request) {
  try {
    requireLocal(request);
    const source = sourceData();
    const db = getStore();
    try {
      db.importRecords(source.records,source.source,source.dataset);
      return json(db.snapshot(source.source,source.summary,suggestions()));
    } finally { db.close(); }
  } catch (e) { console.error('Lectura del laboratorio:', e instanceof Error ? e.message : 'error'); return json({error:'No se pudo abrir el laboratorio local. Comprueba la importación y el modo de entrenamiento.'},503); }
}
export async function POST(request: Request) {
  try {
    requireLocal(request);
    const raw = await request.text();
    if (raw.length > 16000) return json({error:'Solicitud demasiado grande.'},413);
    const body = JSON.parse(raw) as { action: string; eventId: string; version: number; input: MovementInput; productId: string; targetId: string; reason: string; name: string; codes: Code[]; effiId: string | null };
    const db = getStore();
    try {
      let result: unknown;
      switch(body.action) {
        case 'provisional': result=db.createProvisional(body.eventId,actor); break;
        case 'save': result=db.saveReview(body.input,actor); break;
        case 'confirm': result=db.confirm(body.eventId,body.version,actor); break;
        case 'identify': result=db.identify(body.productId,body.name,body.codes,body.effiId,actor); break;
        case 'merge': result=db.merge(body.productId,body.targetId,body.reason,actor); break;
        default: return json({error:'Acción desconocida.'},400);
      }
      return json({ok:true,result});
    } finally { db.close(); }
  } catch(e) { return json({error: e instanceof Error ? e.message : 'No se pudo guardar.'},400); }
}
