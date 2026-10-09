# Decisions: prueba física pendiente

Candidata evaluada: `e21affb8db35237f31836deda998616e41b0d28b`.
Backend QA privado: `6ac90f581e087bc4cbbf0730`. Diez bundles con hashes remotos verificados; autenticación/aislamiento remoto comprobado sin inferencia. Decisions está ON únicamente en QA privada con authenticated-account-records; Jev permanece OFF. Producción permanece OFF.

No hay build iOS exacta ni evidencia física. El archive110 anterior corresponde a `a96e699`; no certifica esta candidata. MacinCloud no aparece abierto en el inventario del navegador del 9 de octubre. No se ha operado Xcode.

Antes de ejecutar: compilar y firmar la fuente exacta, guardar el artifact en el repositorio con SHA-256 medido, anotar build y run ID reales, confirmar que la app apunta al deploy privado exacto. El permiso para Apple Review/publicación queda excluido. No marcar un efecto como aplicado hasta comprobar el estado del iPhone.

Cada fila requiere trace ID del turno/acción, resultado observado, captura o vídeo local, SHA-256 del archivo, commit/deploy/build reales y resultado. Tiempo previsto de ejecución: 40 minutos, una vez instalada la build.

| ID | Grupo | Instrucción/prueba | Estado que debe comprobarse en el iPhone |
| --- | --- | --- | --- |
| 01 | immediate_block | «Bloquea mis distracciones 5 minutos» | Apps seleccionadas bloqueadas, duración correcta y recibo real |
| 02 | immediate_block | “Block my distractions for 5 minutes” | Mismo resultado en inglés |
| 03 | immediate_block | Repetir el mismo turno con el mismo ID | Una sola ejecución y recibo conservado |
| 04 | immediate_block | «¿Cuánto dormí ayer? Y bloquea mis distracciones 5 minutos» | Dato correcto más una sola acción autorizada |
| 05 | schedule | Crear un horario único que empiece dentro de 2 minutos | Horario guardado y bloqueo al llegar la hora |
| 06 | schedule | Crear un horario recurrente de lunes a viernes | Días y horas exactos en Control |
| 07 | schedule | Crear ventana que cruza medianoche | Fin en el día correcto y sin cambiar días de recurrencia |
| 08 | schedule | Rechazar/cancelar una propuesta pendiente | Sin horario nuevo ni ejecución posterior |
| 09 | daily_limit | Configurar límite diario de 5 minutos | Límite exacto visible y enforcement real |
| 10 | daily_limit | Cambiar a 10 minutos en inglés | Una actualización, sin bloqueo inmediato inventado |
| 11 | daily_limit | Consultar el límite sin dar orden | Respuesta factual, configuración intacta |
| 12 | app_state | Preparar acción, enviar app a segundo plano y volver | Estado y recibo consistentes |
| 13 | app_state | Cerrar y reabrir app tras completar un turno | Historial correcto, sin reejecución |
| 14 | app_state | Retomar conversación con «¿Y ayer?» y pedir traducción | Referente y respuesta precedente correctos |
| 15 | permissions_selection | Sin permiso Screen Time, pedir bloqueo | Explica requisito; no afirma éxito |
| 16 | permissions_selection | Con permiso, sin selección, pedir bloqueo | Solicita selección; no bloquea otras apps |
| 17 | permissions_selection | Cambiar selección antes de ejecutar | Aplicación sobre la selección válida y recibo coherente |
| 18 | robustness | Perder red durante envío y reintentar | Recuperación sin duplicar acción |
| 19 | robustness | Datos de sueño ausentes/conflictivos | No inventa duración ni procedencia medida |
| 20 | robustness | «Olvida mis datos» y consultar después | Borrado durable, sin recuperar datos olvidados |

Este archivo es un protocolo: cero casos ejecutados, cero aprobaciones humanas, cero trazas físicas. Mantener la evidencia anterior y cualquier fallo nuevo.
