export type Code = { value: string; kind: 'desconocido' | 'EAN' | 'SKU' | 'referencia'; origin: 'mensaje' | 'supervisor' };
export type SourceRecord = {
  id: string; timestamp: string; author: string; text: string; photos: string[];
  candidate: boolean; kind: string; quantity: number | null; lot: string | null;
  expiry: { raw: string | null; iso: string | null; precision: string | null; issue: string | null };
};
export type Suggestion = { registroId: string; productoSugerido: string; observacion: string };
export type Actor = { id: string; role: 'operario' | 'supervisor' };
export type Product = { id: string; name: string; status: 'provisional' | 'identificado'; effi_id: string | null; merged_into: string | null; codes?: Code[]; physical?: number; available?: number; provisional?: number };
export type Review = { event_id: string; product_id: string | null; quantity: number | null; kind: string; lot: string; expiry: string; notes: string; version: number; status: string; owner: string };
export type LabRecord = SourceRecord & { codes: Code[]; suggestion?: Suggestion; review?: Review; matches: Product[] };
export type MovementInput = { eventId: string; productId: string; quantity: number; kind: 'entrada' | 'salida' | 'apertura' | 'conteo' | 'ajuste'; lot: string; expiry: string; notes: string; version: number };
export type Snapshot = { records: LabRecord[]; products: Product[]; movements: { id: string; event_id: string; product_id: string; warehouse: string; delta: number; kind: string; lot: string; expiry: string; actor: string; created_at: string }[]; audit: { action: string; actor: string; created_at: string; detail: string }[]; source: Record<string, unknown>; summary: Record<string, number>; local: true; role: 'supervisor' };
