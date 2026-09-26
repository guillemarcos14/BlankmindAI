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

La evidencia final debe vincular los informes de pruebas, el panel y una evaluación completa al commit limpio exacto. No repetir una batería fallida hasta obtener verde, cambiar expectativas ni aplicar al nuevo código los dictámenes de otro runtime sin comprobar los hashes exactos de cada entrada.

## Límites y coste

La segunda solicitud puede aumentar consumo y carga durante una lentitud compartida. El máximo sigue siendo dos por extracción; ambas fallan si el servicio permanece indisponible. Sobre el informe histórico de 105, al menos 82 extracciones (28 timeouts y 54 éxitos posteriores a 12 segundos) habrían podido abrir un segundo intento: es una estimación de disparos, no una medida de tokens ni de rescates reales. Una respuesta original válida a los 13 segundos sigue pudiendo ganar.

La app conserva un borrador pendiente hasta que se resuelve su reintento; este cambio no añade envío de otro borrador mientras exista ese pendiente. Firma, distribución y los 20 casos físicos de iPhone permanecen separados. No hay nuevo acuse físico ni aprobación productiva en este documento.
