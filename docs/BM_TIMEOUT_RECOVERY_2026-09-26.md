# Recuperación acotada de solicitudes de modelo

Los informes históricos conservan sus 28 timeouts de extracción y un timeout contextual. La causa concreta de esos retrasos no se ha reproducido: el mismo runtime y política de `10fe3ff`, con instrumentación, completó una muestra de 112 extracciones a concurrencia ocho y después los 925 turnos del corpus. No se atribuye esa diferencia a una corrección que todavía no existía.

## Problemas corregidos

El extractor permitía dos intentos dentro de 20 segundos, pero el primero podía consumir el plazo completo. Por tanto, su propio timeout terminal no dejaba ninguna oportunidad de recuperación. La política candidata mantiene viva la primera petición y permite una segunda a los 12 segundos, sólo si todavía no hay resultado. La segunda petición, la reparación de una salida y el reintento temprano comparten un máximo de dos solicitudes y el mismo plazo absoluto de 20 segundos.

La selección del ganador ocurre después del parser de evidencia literal y del validador existentes. Los valores fielmente extraídos pero no admitidos por el dispositivo conservan sus rechazos; no se convierten en hechos autorizados ni se fusionan candidatos. Un resultado inválido rápido no elimina la otra petición aún válida. Los errores explícitos de cuota/autenticación no disparan reintentos. Se cancelan las peticiones restantes y sus temporizadores; la cancelación local no demuestra que el proveedor haya detenido su cómputo o facturación. Ningún intento ejecuta acciones.

El adaptador también descartaba `model_error` antes de entregar el resultado a la app. La app guardaba un respaldo determinista como turno completado, de modo que el UUID ya no permitía recuperar la inferencia. Ahora recibe sólo un booleano interno y, ante fallo del modelo, devuelve el error genérico recuperable antes de preparar estado, incrementar la versión o encolar una acción. El turno y texto originales permanecen reintentables; los checkpoints previamente preparados conservan su recuperación idempotente.

Una cancelación canónica coherente —intención, estado y decisión cancelados, sin acciones— sigue retirando una instrucción pendiente aunque falle el modelo. Esto no acredita desactivar una restricción ya aplicada en el dispositivo. No cambia la política operativa de los adaptadores de WhatsApp/SMS ni el contrato público de errores. La redacción contextual conserva su plazo de 12 segundos y su respaldo seguro.

## Evidencia separada por propósito

- Diagnóstico anterior a la corrección: `tmp/timeout-correction-20260926/reproduction-c8.json`, una preflight y 112 extracciones, cero timeouts. Sólo extracción; no se recuperaron contratos contextuales en ese primer panel.
- Una pasada completa instrumentada sobre `10fe3ff`: `tmp/bm-semantic/timeout-diagnostic-10fe3ff-live.json`. 925 fuentes activas, cero fallos operativos y siete dimensiones deterministas correctas. Mediana 1.567 ms, p95 3.217 ms, p99 5.513 ms y máximo 12.186 ms. Sus 925 respuestas visibles siguen sin dictamen independiente; no se presenta como aprobación de release. Las dos peticiones más lentas comunicaron aproximadamente 11,9 segundos de procesamiento del proveedor, sin demostrar la causa de los timeouts históricos.
- Pruebas HTTP locales con tiempos escalados contrastan el comportamiento previo y la recuperación ante peticiones detenidas, cuerpos detenidos, conexión interrumpida y candidatos inválidos. Son fallos controlados, no medición del proveedor ni ejecución física.
- El panel `live-fault-panel.cjs` está diseñado para retener deliberadamente la primera respuesta de ocho casos, en cuatro pares antes de entregar cabeceras y cuatro durante la lectura del cuerpo. Usa respuestas reales de API para el segundo intento, conserva el control anterior y comprueba estado/acciones. No simula que el proveedor original haya vuelto a fallar ni demuestra ahorro de coste.

## Resultado final del candidato

El commit limpio `fcf5f9bc53585ae093022f33a71040d941185370`, fijado en la rama remota `codex/backend-release-candidate-timeout-recovery-2026-09-26`, completó una pasada de 925 turnos con modelo activo, cero fallos operativos y cero timeouts. Tras vincular el dictamen independiente, los 925 turnos pasan las ocho dimensiones: 842 respuestas excelentes y 83 aceptables, ninguna deficiente ni hallazgo grave. El juez reutilizó 888 dictámenes por entrada completa idéntica y generó 37 nuevos; 882 coincidencias procedían de la semilla histórica y seis se reutilizaron dentro de la ejecución. El corpus es de desarrollo, no un conjunto reservado.

Latencia observada a concurrencia ocho: mediana 1.526 ms, p95 3.155 ms, p99 5.063 ms y máximo 13.966 ms. Hubo cuatro segundas peticiones entre 920 extracciones (0,435 % de solicitudes adicionales): ganó la segunda en tres casos y la primera en uno. Esto no demuestra tres timeouts evitados: las primeras peticiones canceladas podrían haber terminado antes de 20 segundos. Tampoco se atribuye causalmente la diferencia respecto a 105 al nuevo código: la pasada diagnóstica anterior ya terminó sin fallos.

El panel con retrasos deliberados y API real terminó: los ocho controles agotaron 20,004–20,035 segundos y los ocho candidatos recuperaron respuesta en 13,145–15,596 segundos. Estado y acciones coinciden en 8/8 pares; la auditoría independiente pasa 41/41 comprobaciones. Las pruebas locales cubren además el plazo agotado, respuesta inválida, reparación, error terminal, cancelación y ausencia de filtración de métricas internas.

Harness 63/63 con baseline anterior a las ediciones y `--enforce-scope` en feature y release. CI del SHA exacto: BM `36266646997` e iOS `36266646993`, ambos correctos. La integración `8227095e645a477f3461791b631ae3316e47cd73` comparte el árbol completo `87e516a5baa19bf6d69b6ea92e114712334d6f33` y está desplegada sólo en staging privado: `6ab8208ee5651eb68c4d343f`. Se verificaron cuatro ZIP y 38 entradas de código, rechazo anónimo 401 y aislamiento. Una preflight acredita Luna activo; los nueve checks cloud y las doce limpiezas pasan. El smoke no registra la procedencia de modelo de cada respuesta y su recibo fallido es simulado.

`docs/PRODUCT_NEXT_EVIDENCE.json` conserva los archivos originales y hashes de diagnóstico, panel, modelo, juez, vinculación, CI y despliegue. Los commits posteriores de documentación no sustituyen el SHA evaluado ni requieren otro deploy. La corrección de recuperación y su gate de modelo quedan completados; los informes de 105 conservan sus 29 fallos originales, sin reclasificación ni atribución de una causa no demostrada.

## Límites y coste

La segunda solicitud puede aumentar consumo y carga durante una lentitud compartida. El máximo sigue siendo dos por extracción; ambas fallan si el servicio permanece indisponible. Sobre el informe histórico de 105, al menos 82 extracciones (28 timeouts y 54 éxitos posteriores a 12 segundos) habrían podido abrir un segundo intento: es una estimación de disparos, no una medida de tokens ni de rescates reales. Una respuesta original válida a los 13 segundos sigue pudiendo ganar.

La app conserva un borrador pendiente hasta que se resuelve su reintento; este cambio no añade envío de otro borrador mientras exista ese pendiente. Firma, distribución y los 20 casos físicos de iPhone permanecen separados. No hay nuevo acuse físico ni aprobación productiva en este documento.
