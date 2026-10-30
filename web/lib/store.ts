import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { extractCodes, exactMatches, validateCode } from './identification.ts';
import type { Actor, Code, MovementInput, Product, Review, Snapshot, SourceRecord, Suggestion } from './types.ts';

const supervisor = (actor: Actor) => { if (actor.role !== 'supervisor') throw new Error('Se requiere supervisor.'); };
function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Texto inválido.');
  return value.trim();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export class InventoryStore {
  db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, payload TEXT NOT NULL, hash TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports(hash TEXT PRIMARY KEY, source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('provisional','identificado')), effi_id TEXT UNIQUE, merged_into TEXT REFERENCES products(id));
      CREATE TABLE IF NOT EXISTS codes(product_id TEXT NOT NULL REFERENCES products(id), value TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, UNIQUE(product_id,value,kind));
      CREATE TABLE IF NOT EXISTS reviews(event_id TEXT PRIMARY KEY REFERENCES events(id), product_id TEXT REFERENCES products(id), quantity INTEGER, kind TEXT NOT NULL DEFAULT 'conteo', lot TEXT NOT NULL DEFAULT '', expiry TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'borrador', owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES events(id), product_id TEXT NOT NULL REFERENCES products(id), warehouse TEXT NOT NULL CHECK(warehouse='speedway-principal'), delta INTEGER NOT NULL, kind TEXT NOT NULL, lot TEXT NOT NULL, expiry TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS movements_product ON movements(product_id,warehouse,lot,expiry);
      CREATE INDEX IF NOT EXISTS codes_value ON codes(value);
      CREATE TRIGGER IF NOT EXISTS immutable_movements_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'El historial es inmutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_movements_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'El historial es inmutable'); END;
    `);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(action: string, actor: Actor, detail: unknown) {
    this.db.prepare('INSERT INTO audit(action,actor,detail) VALUES(?,?,?)').run(action, actor.id, JSON.stringify(detail));
  }
  importRecords(records: SourceRecord[], source: { sha256: string; fileName: string }, dataset = 'entrenamiento') {
    if (dataset !== 'entrenamiento' || source.fileName !== 'WhatsApp_chat_entrenamiento.zip') throw new Error('Solo se admite el chat de entrenamiento.');
    return this.transaction(() => {
      let inserted = 0;
      const insert = this.db.prepare('INSERT INTO events(id,payload,hash,source) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING');
      for (const record of records) {
        const payload = JSON.stringify(record);
        const hash = createHash('sha256').update(canonical(record)).digest('hex');
        const previous = this.db.prepare('SELECT payload FROM events WHERE id=?').get(record.id);
        if (previous && canonical(JSON.parse(String(previous.payload))) !== canonical(record)) throw new Error(`La evidencia ${record.id} cambió; revisar antes de reemplazarla.`);
        inserted += Number(insert.run(record.id, payload, hash, 'whatsapp:entrenamiento').changes);
      }
      this.db.prepare('INSERT OR IGNORE INTO imports(hash,source) VALUES(?,?)').run(source.sha256, source.fileName);
      if (inserted) this.audit('importacion', { id: 'importador', role: 'supervisor' }, { inserted, sha256: source.sha256 });
      return { inserted, duplicates: records.length - inserted };
    });
  }
  record(id: string): SourceRecord {
    const row = this.db.prepare('SELECT payload FROM events WHERE id=?').get(id);
    if (!row) throw new Error('Mensaje no encontrado.');
    return JSON.parse(String(row.payload));
  }
  review(id: string): Review | undefined { return this.db.prepare('SELECT * FROM reviews WHERE event_id=?').get(id) as Review | undefined; }
  product(id: string): Product {
    const product = this.db.prepare('SELECT * FROM products WHERE id=?').get(id) as Product | undefined;
    if (!product || product.merged_into) throw new Error('Producto no encontrado o ya enlazado; recarga la ficha.');
    return product;
  }
  createProvisional(eventId: string, actor: Actor): Product {
    supervisor(actor);
    return this.transaction(() => {
      const record = this.record(eventId);
      if (!record.candidate) throw new Error('Este mensaje no es un candidato.');
      const existing = this.review(eventId);
      if (existing?.product_id) return this.product(existing.product_id);
      const codes = extractCodes(record.text);
      const id = `SP-P-${randomUUID()}`;
      const name = codes.length ? `Producto por identificar · código ${codes[0].value}` : `Producto por identificar · ${id.slice(-8)}`;
      this.db.prepare('INSERT INTO products(id,name,status) VALUES(?,?,?)').run(id, name, 'provisional');
      for (const code of codes) this.db.prepare('INSERT INTO codes VALUES(?,?,?,?)').run(id, code.value, code.kind, code.origin);
      this.db.prepare(`INSERT INTO reviews(event_id,product_id,quantity,kind,expiry,owner) VALUES(?,?,?,?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET product_id=excluded.product_id,version=reviews.version+1`).run(eventId,id,record.quantity,['entrada','salida'].includes(record.kind) ? record.kind : 'conteo',record.expiry.iso || '',actor.id);
      this.audit('crear_provisional', actor, { eventId, productId: id, codes });
      return this.product(id);
    });
  }
  saveReview(input: MovementInput, actor: Actor): Review {
    return this.transaction(() => {
      const record = this.record(input.eventId);
      if (!record.candidate) throw new Error('Este mensaje no admite movimientos.');
      this.product(input.productId);
      this.validateMovement(input);
      const previous = this.review(input.eventId);
      if (previous?.status === 'confirmado') throw new Error('Este mensaje ya tiene un movimiento confirmado.');
      if (previous && actor.role !== 'supervisor' && previous.owner !== actor.id) throw new Error('Solo puedes editar tus propios borradores.');
      if ((previous?.version || 0) !== input.version) throw new Error('Otra revisión modificó la ficha. Recarga antes de guardar.');
      this.db.prepare(`INSERT INTO reviews(event_id,product_id,quantity,kind,lot,expiry,notes,version,owner) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET product_id=excluded.product_id,quantity=excluded.quantity,kind=excluded.kind,lot=excluded.lot,expiry=excluded.expiry,notes=excluded.notes,version=excluded.version`).run(
          input.eventId,input.productId,input.quantity,input.kind,text(input.lot,100),text(input.expiry,10),text(input.notes,2000),input.version+1,actor.id);
      this.audit('guardar_borrador', actor, { eventId: input.eventId, version: input.version + 1 });
      return this.review(input.eventId)!;
    });
  }
  validateMovement(input: MovementInput) {
    if (!['entrada','salida','apertura','conteo','ajuste'].includes(input.kind)) throw new Error('Elige el tipo de movimiento.');
    if (!Number.isSafeInteger(input.quantity) || Math.abs(input.quantity) > 1000000 || (input.kind !== 'ajuste' && input.quantity < 0) || (['entrada','salida','apertura'].includes(input.kind) && input.quantity === 0)) throw new Error('Cantidad inválida. Usa unidades enteras.');
    text(input.lot,100); text(input.notes,2000); text(input.expiry,10);
    if (input.expiry && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.expiry)) throw new Error('El vencimiento debe tener formato AAAA-MM.');
    if (['apertura','conteo','ajuste'].includes(input.kind) && !input.notes.trim()) throw new Error('Explica el motivo del conteo, apertura o ajuste.');
  }
  balance(productId: string, lot?: string, expiry?: string): number {
    const filter = lot === undefined ? '' : ' AND m.lot=? AND m.expiry=?';
    const args = lot === undefined ? [productId] : [productId, lot, expiry || ''];
    const row = this.db.prepare(`SELECT COALESCE(SUM(m.delta),0) AS qty FROM movements m JOIN products p ON p.id=m.product_id WHERE COALESCE(p.merged_into,p.id)=?${filter}`).get(...args);
    return Number(row?.qty || 0);
  }
  confirm(eventId: string, version: number, actor: Actor) {
    return this.transaction(() => {
      const review = this.review(eventId);
      if (!review?.product_id) throw new Error('Primero guarda un borrador con producto.');
      if (review.status === 'confirmado') return { duplicate: true }; // Retries never add stock twice.
      if (review.version !== version) throw new Error('La ficha cambió; revisa la versión actual.');
      const product = this.product(review.product_id);
      if (actor.role !== 'supervisor' && (review.owner !== actor.id || product.status !== 'identificado' || !['entrada','salida'].includes(review.kind))) throw new Error('Este movimiento requiere supervisor.');
      const input = { eventId, productId: product.id, quantity: review.quantity!, kind: review.kind, lot: review.lot, expiry: review.expiry, notes: review.notes, version } as MovementInput;
      this.validateMovement(input);
      const current = this.balance(product.id,review.lot,review.expiry);
      if (review.kind === 'apertura' && this.db.prepare('SELECT 1 FROM movements m JOIN products p ON p.id=m.product_id WHERE COALESCE(p.merged_into,p.id)=? LIMIT 1').get(product.id)) throw new Error('La apertura solo se permite antes del primer movimiento. Usa conteo para fijar un saldo.');
      const delta = review.kind === 'conteo' ? review.quantity! - current : review.kind === 'salida' ? -review.quantity! : review.quantity!;
      if (current + delta < 0) throw new Error('Saldo insuficiente en este lote y vencimiento.');
      this.db.prepare('INSERT INTO movements(id,event_id,product_id,warehouse,delta,kind,lot,expiry,actor) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),eventId,product.id,'speedway-principal',delta,review.kind,review.lot,review.expiry,actor.id);
      this.db.prepare("UPDATE reviews SET status='confirmado',version=version+1 WHERE event_id=?").run(eventId);
      this.audit('confirmar_movimiento', actor, { eventId, productId: product.id, delta, previous: current, after: current + delta });
      return { duplicate: false, delta };
    });
  }
  identify(productId: string, name: string, codes: Code[], effiId: string | null, actor: Actor) {
    supervisor(actor);
    return this.transaction(() => {
      const previous = this.product(productId);
      const safeName = text(name,250);
      if (safeName.length < 3) throw new Error('Indica el nombre y la presentación verificados.');
      for (const code of codes) {
        validateCode(code.value);
        if (!['EAN','SKU'].includes(code.kind)) throw new Error('Solo se guardan correspondencias validadas como EAN o SKU.');
        const matches = this.db.prepare("SELECT c.product_id FROM codes c JOIN products p ON p.id=c.product_id WHERE c.value=? AND p.status='identificado' AND p.merged_into IS NULL AND p.id<>?").all(code.value,productId);
        if (matches.length) throw new Error('Este código ya corresponde a otro producto. Revisa y enlaza las fichas.');
      }
      this.db.prepare("UPDATE products SET name=?,status='identificado',effi_id=? WHERE id=?").run(safeName,effiId ? validateCode(effiId) : null,productId);
      // Original unclassified codes remain evidence, never become future matches until validated.
      for (const code of codes) this.db.prepare('INSERT INTO codes VALUES(?,?,?,?) ON CONFLICT(product_id,value,kind) DO UPDATE SET origin=excluded.origin').run(productId,validateCode(code.value),code.kind,'supervisor');
      this.audit('identificar_producto',actor,{ productId, previous, name: safeName, codes, effiId });
      return this.product(productId);
    });
  }
  merge(sourceId: string, targetId: string, reason: string, actor: Actor) {
    supervisor(actor);
    return this.transaction(() => {
      if (sourceId === targetId || text(reason,2000).length < 5) throw new Error('Selecciona otra ficha y explica la coincidencia.');
      const from = this.product(sourceId); const target = this.product(targetId);
      if (from.status !== 'provisional' || target.status !== 'identificado') throw new Error('Enlaza una ficha provisional con un producto identificado.');
      const before = this.balance(sourceId) + this.balance(targetId);
      this.db.prepare('UPDATE products SET merged_into=? WHERE id=? OR merged_into=?').run(targetId,sourceId,sourceId);
      this.db.prepare('UPDATE reviews SET product_id=?,version=version+1 WHERE product_id=?').run(targetId,sourceId);
      const after = this.balance(targetId);
      if (before !== after) throw new Error('El enlace alteraría la cantidad total.');
      this.audit('enlazar_provisional',actor,{ sourceId,targetId,reason,before,after, addedUnits: 0 });
      return this.product(targetId);
    });
  }
  products(): Product[] {
    return (this.db.prepare('SELECT * FROM products ORDER BY name').all() as unknown as Product[]).map(p => {
      const codes = this.db.prepare('SELECT value,kind,origin FROM codes WHERE product_id=?').all(p.id) as Code[];
      const physical = p.merged_into ? 0 : this.balance(p.id);
      return { ...p, codes, physical, available: p.status === 'identificado' ? physical : 0, provisional: p.status === 'provisional' ? physical : 0 };
    });
  }
  snapshot(source: Record<string,unknown>, summary: Record<string,number>, suggestions: Suggestion[]): Snapshot {
    const products = this.products();
    // Only explicit, supervisor-validated mappings are eligible for matching.
    const catalog = products.map(p => ({...p, codes: p.codes?.filter(c => c.origin === 'supervisor' && ['EAN','SKU'].includes(c.kind))}));
    const records = this.db.prepare('SELECT payload FROM events ORDER BY rowid').all().map(row => JSON.parse(String(row.payload)) as SourceRecord).filter(r => r.candidate).map(record => {
      const codes = extractCodes(record.text);
      return { ...record, codes, review: this.review(record.id), suggestion: suggestions.find(s=>s.registroId===record.id), matches: exactMatches(codes,catalog) };
    });
    return { records, products, source, summary, local: true, role: 'supervisor', movements: this.db.prepare('SELECT * FROM movements ORDER BY rowid DESC').all() as Snapshot['movements'], audit: this.db.prepare('SELECT action,actor,detail,created_at FROM audit ORDER BY id DESC LIMIT 100').all() as Snapshot['audit'] };
  }
}
