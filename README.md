# Inventario físico Speedway — laboratorio de entrenamiento

Aplicación Next.js + TypeScript para revisar **únicamente WhatsApp_chat_entrenamiento.zip**. El conteo inicial y el prototipo anterior se conservaron en referencias; no son fuentes activas.

## Abrir

Desde la raíz del proyecto, con Node.js 24, PowerShell 7 y pnpm:

```powershell
pwsh -NoProfile -File scripts/import-whatsapp-entrenamiento.ps1
cd web
pnpm install --frozen-lockfile
pnpm build
cd ..
node scripts/start-lab.mjs
```

Abrir http://127.0.0.1:4174/. Para desarrollo con recarga usar `node scripts/start-lab.mjs --dev`. El acceso antiguo 4173 solo redirige al laboratorio si se ejecuta `node scripts/dev-server.mjs`.

## Implementado y probado

- 545 candidatos de entrenamiento; foto y mensaje originales, 54 candidatos con códigos como texto y tres sugerencias visuales revisadas.
- Fichas provisionales con ID propio, búsqueda por código/nombre y validación manual de identidad.
- Guardado persistente en SQLite local, versiones de borrador, auditoría e historial inmutable.
- Entrada, salida, apertura, conteo absoluto por lote/vencimiento y ajuste con motivo.
- Físico provisional separado del disponible. Enlace de provisional a identificado sin sumar unidades nuevas.
- Importación idempotente por ID y contenido canónico. Reconfirmación no duplica movimientos.
- Transacciones y permisos de dominio: operador limitado a sus entradas/salidas identificadas; supervisor para provisional, conteos, apertura y ajustes.

El laboratorio simula un supervisor local explícitamente. **No tiene autenticación real ni es una implementación productiva de Supabase.** Solo arranca sus APIs en modo local y rechaza ejecución en Vercel. No se debe exponer a una red ni publicar el backend SQLite como producción.

## Datos y persistencia

`work/database/speedway-entrenamiento.sqlite` conserva borradores y movimientos al reiniciar. Para respaldarlo, detener primero el servidor y copiar el archivo; no tratar la sincronización concurrente de OneDrive como mecanismo transaccional o copia verificada. Los ZIP permanecen intactos. Las fotos se leen del archivo por referencia exacta.

Una exportación nueva puede cambiar texto/nombres de adjuntos y por tanto IDs: revisar solapamientos antes de importarla. La prueba garantiza reimportación del mismo contenido, no deduplicación universal entre exports modificados.

Los borradores anteriores en localStorage no se migraron automáticamente. Se conserva el prototipo en `referencias/prototipo-anterior/` para consulta.

## Verificación

Desde `web/`:

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Los tests usan bases aisladas. Incluyen dos salidas simultáneas desde conexiones independientes. La prueba del archivo de entrenamiento requiere el derivado local; en CI sin datos privados se omite explícitamente. Los tests SQLite no sustituyen futuras pruebas contra PostgreSQL, RLS y Supabase Auth.

## Integraciones

GitHub, Vercel y Supabase: conexiones verificadas. El código está publicado en la rama `codex/laboratorio-entrenamiento` del repositorio público, con [PR de revisión #1](https://github.com/almacenspeedway-glitch/inventario_speedway/pull/1).

Supabase: proyecto de entrenamiento creado, ocho tablas protegidas con RLS, bucket privado, confirmación transaccional y lista privada de acceso. Se verificaron roles, aislamiento, idempotencia y rechazo de saldo negativo en PostgreSQL, con fixtures revertidas. Ver `database/README.md`. El correo del primer supervisor se registró solo en la configuración privada; no se ha creado una sesión de usuario ni enviado correo.

La interfaz sigue usando el almacén local. Pendiente: conectar Supabase Auth y los flujos de borrador/identificación, transferir evidencia y fotos privadas, verificar concurrencia real en PostgreSQL, publicar en Vercel, activar Telegram/n8n y consultar catálogo oficial Effi. No hay conexión operativa a Telegram, IA remota o Effi. No se ejecutan ajustes en Effi.

Las tres sugerencias visuales existentes no son reconocimiento automático para todas las fotos.

## Estructura

- `web/`: Next.js, dominio transaccional y pruebas.
- `database/`: base SQL aplicada a Supabase y pruebas transaccionales sin datos privados.
- `scripts/`: importador de entrenamiento, lector de fotos y arranque local.
- `work/`: importaciones, base local y pruebas; no versionar.
- `outputs/skills/`: tres skills locales revisadas y validadas; todavía no instaladas en el catálogo global de Codex.
- `outputs/`: entregas y evidencias de revisión.
- `referencias/`: contexto y antecedentes archivados.

No subir ZIP, fotos, bases, conversaciones, credenciales ni derivados de datos a GitHub. No guardar secretos en OneDrive. Mantener secrets de producción en los proveedores; ninguna clave de servicio debe llegar al navegador.
