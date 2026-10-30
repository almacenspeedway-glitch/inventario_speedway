import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { InventoryStore } from './store.ts';
import type { SourceRecord, Suggestion } from './types.ts';

export const root = path.resolve(process.cwd(), '..');
export function requireLocal(request: Request) {
  const host = new URL(request.url).hostname;
  if (process.env.VERCEL || process.env.SPEEDWAY_LOCAL_LAB !== '1' || !['127.0.0.1','localhost'].includes(host)) throw new Error('Laboratorio local desactivado. La operación en nube requiere Supabase y autenticación.');
  // Next may internally normalize request.url to localhost. Verify the actual Host too.
  const actualHost = request.headers.get('host') || new URL(request.url).host;
  if (!/^(127\.0\.0\.1|localhost):4174$/.test(actualHost)) throw new Error('Host local no permitido.');
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin !== `http://${actualHost}`) throw new Error('Origen de solicitud no permitido.');
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Se requiere JSON.');
  }
}
export function sourceData() {
  return JSON.parse(readFileSync(path.join(root,'work/importaciones/entrenamiento-revision.json'),'utf8')) as {
    dataset: string; records: SourceRecord[]; source: {sha256:string;fileName:string}; summary: Record<string,number>
  };
}
export function getStore() {
  const dir = path.join(root,'work/database');
  mkdirSync(dir,{recursive:true});
  return new InventoryStore(path.join(dir,'speedway-entrenamiento.sqlite'));
}
export function suggestions(): Suggestion[] {
  return JSON.parse(readFileSync(path.join(root,'outputs/02_MUESTRA_EXTRACCION_VISUAL_ENTRENAMIENTO.json'),'utf8')).muestras;
}
