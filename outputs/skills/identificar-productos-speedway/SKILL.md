---
name: identificar-productos-speedway
description: Resuelve códigos y fichas provisionales del catálogo Speedway con evidencia, sin duplicar existencias al identificar o enlazar productos.
---

# Identificar productos Speedway

El código siempre es texto. No elimines ceros iniciales ni conviertas números largos a valores numéricos.

## Orden de resolución

- Busca una correspondencia exacta validada por supervisor en Speedway. Devuelve todas las coincidencias si hay más de una.
- Si no existe, consulta Effi por código exacto mediante acceso de lectura verificado o una exportación oficial. No inventes endpoints ni datos del catálogo.
- Una foto puede sugerir nombre, marca y presentación, pero la sugerencia no valida SKU, lote, sabor ni tamaño de otra variante.
- Si hay duda, conserva una ficha provisional con ID propio, mensaje, foto y código original. Sin código, conserva igualmente una identidad interna propia.

## Casos que ya se probaron

`001234567890` permanece igual y de tipo desconocido salvo evidencia adicional. `SKU: AB-00123` conserva letras y guion. `referencia 987654321` no se usa como identidad del producto. Retira nombres de adjuntos y enlaces antes de extraer códigos: contarlos generaba falsos positivos. La muestra actual contiene 54 candidatos con códigos, no 541.

Los nombres parecidos no autorizan una unión. La fotografía de Tylenol permite sugerir concentración y presentación, pero no muestra un lote. Mantén lote desconocido.

## Identificar y enlazar

`identify` completa la misma ficha; `merge` enlaza un provisional con una ficha identificada. Ambos requieren supervisor. Compara físico total antes y después: debe ser idéntico. El historial conserva los IDs originales y la auditoría documenta el enlace. Los códigos sin tipo validado siguen siendo evidencia; para reconocer reportes futuros, registra expresamente la correspondencia como EAN o SKU.

Implementación: `web/lib/identification.ts` y `web/lib/store.ts`. Pruebas: `web/tests/inventory.test.ts`. Esta skill no otorga permisos para escribir en Effi.
