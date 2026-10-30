---
name: importar-whatsapp-speedway
description: Importa y verifica el ZIP de WhatsApp de entrenamiento de Speedway, enlazando adjuntos y detectando reimportaciones sin crear saldo.
---

# Importar WhatsApp Speedway

Trabaja desde la raíz de `inventario_speedway`. Usa `scripts/import-whatsapp-entrenamiento.ps1`; recibe `-SourceFile` y `-OutputFile`. Por defecto lee `registro_del_inventario_whatsapp/WhatsApp_chat_entrenamiento.zip`. El conteo inicial está archivado y no es una fuente activa.

## Procedimiento probado

1. Conserva el ZIP original. Lee `_chat.txt` y enlaza cada `<adjunto: nombre>` con su nombre exacto en el ZIP. No asocies fotos por orden, cercanía o nombre parecido.
2. Para verificar una nueva exportación, genera primero un derivado en `work/importaciones/`. El formato probado es iPhone en español: `[8/10/26, 1:12:13 p. m.]`, con marcas invisibles y espacios no separables.
3. Compara mensajes, candidatos, referencias encontradas y ausentes. WEBP de stickers no equivale a foto de producto. No conviertas audios sin transcripción en inventario.
4. Compara objetos JSON por contenido, no por orden de claves: PowerShell puede cambiar el orden de `expiry`. Este fallo se comprobó al reimportar y el almacén ahora normaliza el contenido.
5. Importa eventos antes de revisar productos. El almacén `web/lib/store.ts` deduplica por ID y rechaza cambios del contenido de un evento existente. La importación no crea movimientos.

## Evidencia de entrenamiento

La exportación revisada contiene 724 mensajes, 545 candidatos, 541 fotos vinculadas y 551 referencias de adjuntos encontradas. Son cifras de esta muestra, no constantes universales para nuevos archivos.

El mensaje `6f139ca01e4fde96` apunta explícitamente a `00003028-PHOTO-2026-10-08-13-12-13.jpg`. Usar ese vínculo para verificar asociación, no inferir que los mensajes siguientes contienen el mismo producto.

## Límites

El ID histórico depende de fecha, autor, cuerpo y ordinal de repetición. Un export que cambie nombres de adjuntos o texto puede generar otros ID. Antes de aceptar una exportación solapada con esos cambios, comparar evidencia y resolver equivalencias; no prometer deduplicación universal de WhatsApp. No importar automáticamente archivos nuevos encontrados en la carpeta.

## Verificación

Desde `web/`: `node --experimental-strip-types --test tests/*.test.ts`. Volver a ejecutar el importador en un archivo temporal y comparar registros estructuralmente. No incluir ZIP, fotos, remitentes ni derivados privados en GitHub.
