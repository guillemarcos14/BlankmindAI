# Decisions: QA ON; producción OFF

La activación global sigue pendiente de calidad, revisión humana y prueba física. Apple Review/publicación y arreglos de voz quedan excluidos. Jev sigue OFF. PR32 conserva la integración sobre50b3773, sin cohortes ni porcentajes de rollout.

## Fuente y cambios

Runtime d6e11280dca7c65cfb8693a9e90e9110dbad3167, candidata evaluada e21affb8db35237f31836deda998616e41b0d28b. Los cambios posteriores de cierre afectan herramientas y documentación, no funciones de producción. La próxima ejecución V2 debe congelar HEAD tras este cierre; no atribuirle una ejecución de e21.

Se corrigieron el503 por puntuación, «ayer» en seguimientos, procedencia y traducción de la última respuesta. Los dos puntos narrativos se normalizan conservando horas. JSON inválido permite una única generación adicional, manteniendo input/schema; negativas e incompletos no se reintentan. Los registros de sueño incompatibles no se promedian. Una acción se describe como preparada hasta el recibo nativo. Terceros e hipótesis no provocan afirmaciones falsas sobre datos o intervalos.

Las cuatro rutas conservan fuentes del propietario, cálculos/unidades, medición/declaración, periodos locales, olvido y fallback. El filtro léxico solo rechaza. Las consultas compactas no escriben acciones ni memoria. Generic Decisions y Jev siguen desactivados.

## Resultados conservados

| Fuente | Prueba | Resultado |
| --- | --- | --- |
|4981f1c|Seguimiento inicial|OFF8/8, ON7/8;503 conservado|
|c14cd8d|Seguimientos corregidos|OFF8/8, ON8/8; Sol16/16 excelente|
|c14cd8d|Amplia anterior|OFF80/80, ON79/80; ocho respuestas ON deficientes conservadas|
|d6e1128|Primer BMB200|Dos errores de body y cuatro flags incorrectos del oráculo conservados|
|e21affb|Segundo BMB200|200 respuestas de proveedor; cero fallos deterministas; equivalencia pendiente|
|e21affb|Amplia congelada|74casos reutilizados,160turnos; OFF80/80, ON80/80; limpieza5/5|

La amplia usa NDJSON local autenticado, proveedor real y PostgreSQL aislado; conserva registros personales y alterna AB/BA sobre el mismo commit OFF/ON. Es regresión reutilizada, no holdout nuevo, Netlify remoto ni iPhone. Hay45respuestas compactas aceptadas, usage completo y todos los costes de clasificación/generación/reparación/fallback contabilizados.

En50consultas factuales por variante, primer texto p50/p95:6466/13632→1663/7922ms; final:7509/14801→2441/9468ms. Coste factual completo estimado0,096781→0,03005458USD. Pasa los cinco mínimos de mejora20%. Fuera de alcance, p50 mejora6,05%/8,56%; p95 empeora11,47%/13,04%, dentro de límites20%. Cero errores funcionales. Sus160revisiones de calidad todavía no se han realizado.

Sol revisó172/200 del segundo BMB200:152excelentes,17aceptables,3deficientes y2flags duros. Se detuvo por shared_budget_spend_limit. No hay aprobación. La auditoría identifica valores de receta no cargados en casos ausentes y confusión entre observaciones de cuenta y resumen iPhone vacío. Se conservan los veredictos originales.

V1 tenía además sparse/recorded y zero/missing de protección materializados igual. V2 incluye las fuentes efectivas, conteos correctos, sparse30min y una sesión completamente pausada para zero. Tests comparan cada gold con las filas suministradas, comprueban200secuencias distintas sin etiquetas de perfil y periodos sin noches válidas. V1 no se sobrescribe. **V2 aún no tiene replay con proveedor ni revisión y no hereda certificación V1.**

## QA y producción

QA privada tiene Decisions ON con authenticated-account-records; flags legacy QA/generic Decisions/Jev false. Deploy e21 ON:6ac90f581e087bc4cbbf0730, diez hashes remotos verificados. Smoke remoto de autenticación/aislamiento/permisos y limpieza completo, sin inferencia ni ejecución nativa. El paquete de cierre y estado vigente se registran en Blank Brain.

Producción conserva6abe94a92bf201769389c075 y flags Decisions/Jev OFF según preflight remoto posterior. No hay SQL aplicado. El preflight de esquema anterior usa limit=0: faltan tablas BMB/memoria. [Plan026→027→028](BM_DECISIONS_SCHEMA_2026-10-09.md) preparado; no ejecutar db push global ni alterar el historial020 existente. CI PostgreSQL valida un esquema desechable, no el catálogo de producción.

Rollback: flag false y republicar paquete compatible, verificar hashes y smoke. Conservar esquema aditivo y datos; no ejecutar DOWN.

## Gates y bloqueos

Harness e21:87/87/scope; CI37954718650 pasa sus tres trabajos. El cierre añade un88ºcheck: reutilización de outputs/reviews con22mutaciones rechazadas. El gate registrado exige SHA/input, fuente limpia, commit exacto, conteos, idioma, juez independiente y oráculo recalculado. No genera llamadas ni reduce mínimos.

Después de un replay V2 completo y su revisión completa, aplicar las reviews al mismo output con bm_apply_recorded_reviews.js; ejecutar bai_release_gate.js con --recorded-model, --recorded-quality y --dataset. No usar review parcial ni generar respuestas nuevas para que encajen con un veredicto.

Techo acumulado14USD: coste conocido estimado13,66169599; reserva conservadora13,79554989. No son factura. Ampliación a19USD solicitada, sin autorización recibida ni cambio de ledger. No quedan procesos pagados activos.

Pendientes: V2/revisión amplia,24pares humanos y20casos físicos exactos con commit/deploy/build, trace, estado observado y SHA del archivo. [Pares e21](BM_DECISIONS_HUMAN_REVIEW_E21_2026-10-09.md), [protocolo físico](BM_DECISIONS_PHYSICAL_E21_2026-10-09.md), [preparación MacinCloud](BM_DECISIONS_MACIN_CLOUD_2026-10-09.md). MacinCloud no está abierto; no existe build física nueva ni upload observado. Archive110 y bloqueo Apple anteriores conservados sin operar Xcode.

Todo el historial y errores se conservan en BM_DECISIONS_GLOBAL_EVIDENCE_2026-10-09.json. El cierre anterior íntegro está en BM_DECISIONS_GLOBAL_BEFORE_FOLLOWUP_2026-10-09.md. Ningún agregado suple un fallo duro ni prueba humana/física.
