# Base Supabase de entrenamiento Speedway

La infraestructura está creada; la interfaz local todavía no utiliza esta base.

## Aplicado y verificado

`bootstrap.sql` documenta el estado inicial del esquema. Se aplicó en el proyecto remoto mediante las migraciones `speedway_training_foundation` y `explicit_private_access_denial`. El archivo es una fuente consolidada para revisión: no ejecutarlo otra vez sobre la base ya inicializada ni tratarlo como una migración incremental de CLI.

- Ocho tablas públicas, con RLS y privilegio de lectura condicionado al usuario autorizado.
- Lista de acceso en esquema privado. La identidad viene de `auth.uid()` y de un correo confirmado en Supabase Auth. `user_metadata` no concede roles.
- Una bodega Speedway común, eventos originales inmutables, productos, códigos, borradores, movimientos, evidencias y auditoría.
- Vista de saldos con `security_invoker`. Provisional separado de disponible.
- RPC de confirmación con validación de permisos y versión, bloqueo de producto/ficha, conteo absoluto, rechazo de saldo negativo e idempotencia por evento.
- Bucket `speedway-training-evidence`, privado, con límite de 10 MiB por imagen. Lectura ligada a evidencia visible por RLS. Todavía sin política de carga desde cliente.

La lista de acceso se administra por un canal privilegiado. Los correos autorizados y credenciales no se incluyen en este repositorio. Reservar un correo no crea una cuenta ni demuestra que su propietario haya iniciado sesión.

## Pruebas

`verify_foundation.sql` se ejecutó contra PostgreSQL 17 en Supabase. Crea fixtures solo dentro de una transacción y termina con `rollback`; no envía emails ni conserva usuarios o movimientos de prueba.

Verifica supervisor/operario, acceso a eventos propios, bloqueo de escritura directa, saldo, idempotencia, rechazo de ajustes/provisionales por operario, bloqueo de salidas insuficientes y ausencia de escalamiento por metadata editable. Después de la prueba: cero eventos, cero movimientos y cero usuarios Auth; la autorización privada del supervisor se conserva.

Advisors de seguridad: sin hallazgos tras la configuración. Advisors de rendimiento: avisos informativos de [índices aún no utilizados](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), esperables en esta base vacía. Se conservan los índices de claves foráneas y campos de políticas para evaluar con carga real.

## Conexión que aún falta

1. Implementar entrada por Supabase Auth y verificación de sesión en servidor.
2. Completar RPC de recepción durable, guardado, identificación y enlace con las mismas invariantes del dominio local. Nunca dar permisos de escritura directa al ledger para resolver un error de acceso.
3. Transferir entrenamiento y fotos por un flujo autenticado, validando hashes e idempotencia, sin publicarlos en GitHub.
4. Repetir las pruebas de concurrencia con conexiones PostgreSQL independientes y el recorrido de navegador completo.
5. Publicar en Vercel cuando el backend remoto esté conectado. La API local se bloquea en Vercel deliberadamente.

No hay saldo real ni ajustes en Effi. La primera apertura real requiere su propia revisión.
