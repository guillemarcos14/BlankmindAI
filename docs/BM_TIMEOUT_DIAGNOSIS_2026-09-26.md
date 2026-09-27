# Diagnóstico de los timeouts de BM Final

Los 29 timeouts históricos siguen sin darse por resueltos. Este cambio permite medir dónde se consumen los plazos y libera el cuerpo de respuestas HTTP fallidas. Conserva modelo, petición, plazos, reintentos, estado, acciones y criterios de aprobación.

## Evidencia anterior y reproducción acotada

El informe inmutable de `105cf12` contiene 28 extracciones abortadas a los 20 segundos y una contextualización abortada a los 12. En los 28 casos el primer intento agotó todo el presupuesto; el segundo intento existente solo puede recuperar errores tempranos. No había tiempo restante para recuperarse de ese timeout propio.

Dentro de la misma batería, 22 de las 28 peticiones abortadas tienen otra petición byte a byte idéntica que terminó. Los 28 textos aparecen también en turnos satisfactorios. No se observa una relación creciente con el tamaño del mensaje o del historial. El código actual completó 54 extracciones válidas después de 12 segundos: restaurar un corte inicial a los 12 segundos interrumpiría algunas respuestas útiles. Los informes no contienen fases de red ni datos suficientes para atribuir la causa a proveedor, red o generación.

Se hizo una preflight satisfactoria y 24 peticiones adicionales, secuenciales, sobre ocho casos con timeout histórico y cuatro controles. Cada caso recibió ambas configuraciones, alternando el orden: configuración vigente frente a `reasoning.effort: low`. Las 25 peticiones terminaron HTTP200, sin timeout ni reintento. La preflight confirmó `medium` como configuración efectiva actual, coherente con [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

| Configuración | Peticiones comparadas | Mediana | Máximo | Tokens de salida | Campos rechazados por el validador |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vigente, medium implícito | 12 | 1.586 ms | 4.261 ms | 1.364 | 3 |
| Low explícito | 12 | 1.939 ms | 5.380 ms | 1.172 | 3 |

Esta muestra pequeña y conocida no demuestra una mejora de latencia con low ni que los timeouts hayan desaparecido. Su concurrencia uno difiere de la concurrencia ocho del informe original. No cambia el modelo del producto ni sustituye una evaluación completa o una prueba de dispositivo.

El script diagnóstico pasó `null` como estado inicial al validador en cuatro pares; el handler real usa `undefined`. Las ocho excepciones de validación fueron del instrumento, posteriores a respuestas HTTP200 válidas. Se conserva el archivo original y se reaplica únicamente el parser y el validador offline con el estado correcto: las 24 citas son literales y seis campos en total son rechazados por las mismas reglas. No se regeneraron respuestas ni se presentan los rechazos de campos como extracciones perfectas.

## Instrumentación incorporada

`bm-model-request.js` registra por intento la fase de espera de cabeceras o lectura del cuerpo, presupuesto, duración, HTTP status, identificador de petición cuando existe, tiempo de procesamiento comunicado por el proveedor y contadores numéricos de uso. El mismo AbortSignal limita cabeceras y cuerpo. Ante HTTP fallido se solicita cancelar el cuerpo sin leerlo ni esperar indefinidamente a su cancelación.

Las métricas conservan solo campos permitidos. No incluyen credenciales, prompts, texto generado, mensajes arbitrarios de error ni cuerpos HTTP fallidos. Las trazas internas conservan cada intento; los logs aplanan los contadores numéricos sin relajar el filtro general de privacidad. El contrato público y las superficies de usuario no reciben estas métricas.

La extracción mantiene su presupuesto total de 20 segundos y un máximo de dos intentos; la contextualización mantiene 12 segundos. Una extracción cuyo primer intento agota 20 segundos sigue sin reintento posterior. La instrumentación no se presenta como una corrección de la latencia ni concede aprobación de release.

## Evidencia y siguiente criterio

Los archivos originales y el diagnóstico permanecen en `tmp/timeout-diagnosis-20260926`: `artifact-audit.json`, `preflight.json`, `paired.json` y `paired-offline-validation.json`. `docs/PRODUCT_NEXT_EVIDENCE.json` fija sus hashes y conserva el historial anterior.

Las pruebas de transporte deben verificar abortos reales de señal antes de cabeceras y durante el cuerpo, cancelación de cuerpos fallidos que no resuelve, conservación del plazo compartido, métricas de intentos recuperados y ausencia de datos privados en logs/respuesta pública. Los tests no convierten los 29 fallos históricos en éxitos.

Para decidir otra corrección se necesitan fallos reproducidos con estas métricas. No ampliar a 30 segundos, bajar razonamiento, añadir peticiones paralelas o repetir baterías completas sin una hipótesis concreta. La fiabilidad sigue pendiente antes de producción; las pruebas de la build firmada y del iPhone pueden avanzar de forma independiente.
