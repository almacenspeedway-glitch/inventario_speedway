import type { Code, Product } from './types.ts';

export function extractCodes(text: string): Code[] {
  const clean = text.replace(/<adjunto:[^>]+>/gi, '').replace(/https?:\/\/\S+/gi, '');
  const found = new Map<string, Code>();
  for (const match of clean.matchAll(/\b(EAN|SKU|ref(?:erencia)?|c[oó]digo)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._-]*[A-Z0-9])\b/gi)) {
    if (!/\d/.test(match[2])) continue;
    const label = match[1].toUpperCase();
    found.set(match[2], { value: match[2], kind: label === 'EAN' || label === 'SKU' ? label : label.startsWith('REF') ? 'referencia' : 'desconocido', origin: 'mensaje' });
  }
  for (const match of clean.matchAll(/(?<![\w.-])\d{6,20}(?![\w.-])/g)) {
    if (!found.has(match[0])) found.set(match[0], { value: match[0], kind: 'desconocido', origin: 'mensaje' });
  }
  return [...found.values()];
}

// An exact code may have more than one match. The caller must never select the first arbitrarily.
export function exactMatches(codes: Code[], products: Product[]): Product[] {
  const usable = codes.filter(c => c.kind !== 'referencia').map(c => c.value);
  return products.filter(p => !p.merged_into && p.status === 'identificado' && p.codes?.some(c => usable.includes(c.value)));
}

export function validateCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('El código debe ser texto, entre 1 y 100 caracteres.');
  return value.trim();
}
