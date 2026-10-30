---
name: revisar-movimientos-speedway
description: Revisa y prueba movimientos de inventario Speedway, sus permisos y la separación de físico provisional, disponible y evidencia histórica.
---

# Revisar movimientos Speedway

Una bodega tiene un saldo común de Speedway; no repartas saldos por tienda. Los mensajes son evidencia y no generan saldo al recibirse.

## Significado de cada operación

- Entrada suma; salida resta en el lote y vencimiento indicados.
- Conteo fija el saldo observado del lote: el movimiento es la diferencia respecto del saldo confirmado. Nunca sumes el conteo como entrada por defecto.
- Apertura solo antes del primer movimiento del producto.
- Ajuste es un cambio con signo y motivo; conserva el historial previo.

El operario confirma solo sus entradas/salidas de productos identificados. Supervisor: apertura, conteos, ajustes y físico provisional. Una selección de rol en pantalla no sustituye autenticación. El laboratorio actual declara una identidad local de prueba; usuarios reales requieren Supabase Auth.

## Invariantes probadas

- Un evento origina como máximo un movimiento confirmado; reintentar una confirmación no suma nuevamente.
- Versiones de borrador evitan sobrescribir correcciones simultáneas.
- Confirmación y cálculo de saldo ocurren en una transacción. Dos salidas simultáneas sobre una unidad producen una aprobación y un rechazo, nunca saldo negativo.
- Lotes y vencimientos no se intercambian para compensar una salida.
- Físico provisional no se incluye en disponible. Identificar/enlazar conserva total sin volver a insertar movimientos.
- Mensajes incompletos siguen recibidos y pendientes; no inventes cantidad o fecha para aprobarlos.

Prueba el recorrido UI → API → base → historial además de las pruebas de dominio. En entrenamiento usa un motivo que indique explícitamente la prueba. No presentes saldos de ejemplo como inventario real.

Ejecuta `node --experimental-strip-types --test tests/*.test.ts` desde `web/`. Los tests usan bases aisladas y una carrera real entre dos conexiones. Al migrar a PostgreSQL vuelve a ejecutar casos equivalentes contra RLS y transacciones reales; los tests SQLite no demuestran permisos en Supabase.
