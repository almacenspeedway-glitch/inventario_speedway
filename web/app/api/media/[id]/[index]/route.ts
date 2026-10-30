import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { root, requireLocal, sourceData } from '../../../../../lib/local';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id:string;index:string}>}) {
  try {
    requireLocal(request);
    const {id,index} = await context.params;
    if (!/^[a-f0-9]{16}$/.test(id) || !/^\d+$/.test(index)) return new Response('No encontrada',{status:404});
    const record = sourceData().records.find(r=>r.id===id && r.candidate);
    const entry = record?.photos[Number(index)];
    if (!entry) return new Response('Sin foto vinculada',{status:404});
    const {stdout} = await promisify(execFile)('pwsh',['-NoLogo','-NoProfile','-File',path.join(root,'scripts/read-zip-photo.ps1'),'-ZipPath',path.join(root,'registro_del_inventario_whatsapp/WhatsApp_chat_entrenamiento.zip'),'-EntryName',entry],{encoding:'buffer',maxBuffer:12*1024*1024});
    return new Response(new Uint8Array(stdout),{headers:{'Content-Type':entry.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch { return new Response('No se pudo leer la foto.',{status:503}); }
}
