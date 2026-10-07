# BM: seguimiento individual persistente

## Resultado

Una cronologia por UUID autenticado conserva varias observaciones explicitas por turno, su unidad, fecha, zona horaria, procedencia y evidencia. Distingue rutinas declaradas, ocasiones concretas, estimaciones diarias de salud y proteccion ejecutada. Nunca equipara bloqueo con uso del movil ni con descanso.

El worker BMB existente revisa cada cuenta configurada una vez por dia local. Las cuentas con permisos activos conservan su tick de cinco minutos; las demas se comprueban cada hora. Un lease de diez minutos evita evaluaciones simultaneas; fallos esperan treinta minutos, con tres intentos diarios. El analisis no necesita permiso para notificar ni autoriza acciones nuevas. Nuevas declaraciones personales registran una cuenta vinculada con permisos apagados; la migracion incorpora memorias previas sin cambiar permisos existentes.

## Evidencia y aprendizaje

- Se reutilizan onboarding, conversaciones, sesiones, feedback, outcomes, memoria y fuentes wellness/wearable vinculadas y consentidas. No se habilita ninguna API nueva ni se exportan muestras crudas de HealthKit.
- Los resúmenes diarios existentes se adaptan a duracion, inicio estimado del sueño y despertar. `bedtime_local` del productor actual proviene de muestras de sueño, por lo que se etiqueta `sleep_onset`, nunca como hora declarada de acostarse. Su agrupacion original por fecha de inicio limita la exactitud de noches que cruzan medianoche; se conserva como estimacion con confianza limitada, no evidencia clinica.
- Una variacion numerica necesita al menos tres fechas recientes de las cuatro anteriores, siete fechas de referencia y tres comparables por tipo de dia. Se comparan laborables con laborables y fines de semana con fines de semana, usando medianas, dispersion y diferencia circular para horarios. Las fuentes y tipos de medicion no se mezclan. Las rutinas habituales no se multiplican en noches inventadas.
- El mismo `bmb-brain` revisa evidencia, alternativas, incertidumbre y resultados de intervenciones. Guarda un informe incluso cuando decide permanecer silencioso. El informe contiene referencias verificadas a filas de la cuenta, cobertura y cambios; son hipotesis, no diagnosticos ni pruebas causales.
- Lectura acotada a 35 dias: hasta 2.000 observaciones y 80 filas por otra fuente. El digest del modelo limita filas y declara truncamientos; el mismo planner conserva sus consultas de lectura. Datos faltantes, parciales y agregados no se convierten en mediciones individuales.

## Preguntas y autonomia

Una incertidumbre relevante puede crear una pregunta persistente con evidencia y tema. Las preguntas abiertas caducan a siete dias; una pregunta abierta, respondida o descartada impide repetir el tema durante siete dias. Las respuestas y los descartes requieren evidencia literal del turno actual y la identidad de una pregunta abierta. Una conversacion distinta no la cierra, y el silencio no equivale a satisfaccion.

La pregunta pasa por los permisos, horarios, estado de chat y presupuesto BMB existentes. Puede notificarse o mantenerse silenciosa; preguntar no autoriza bloquear ni modificar horarios. La reserva se recupera con el mismo ID, tres intentos y treinta minutos de espera; se revalidan permisos y que la pregunta siga abierta. APNs aceptado es evidencia de transporte, no lectura ni entrega fisica.

Al tocar la notificacion iOS abre Chat y consulta la pregunta asociada al evento, filtrando por cuenta, vigencia y transporte. Se muestra sin crear un turno ficticio, borrar historial, enviar mensajes automaticamente ni reemplazar un borrador/audio/peticion pendiente. Un fallo de conexion conserva el ID para reintentar; cambiar de cuenta invalida la respuesta anterior. La respuesta del usuario vuelve al mismo cerebro y se vincula atomicamente al seguimiento.

Se elimina la heuristica aislada de dos salidas tempranas y su lectura redundante de sesiones en cada tick: las sesiones pasan a la revision diaria contextual. Se mantienen los recibos nativos y señales de umbral, que siguen aportando hechos utiles. No se eliminan endpoints legacy usados por canales externos.

## Persistencia y privacidad

Migracion `028_bmb_longitudinal.sql`: `bmb_observations`, `bmb_daily_reviews`, `bmb_followups`, RLS y funciones privadas. Extiende el commit de memoria existente mediante un trigger transaccional; no introduce otra cola de acciones ni otro commit independiente. Replays conservan idempotencia. Correcciones de una misma medicion conservan el historial de versiones; memorias habituales antiguas no reemplazan correcciones posteriores.

El olvido existente corta toda personalizacion historica automatica: redacta valores/evidencia/informes/preguntas previos y cancela evaluaciones en vuelo. Fuentes agregadas que cruzan el corte quedan excluidas. El historial conversacional conserva el contrato de recuperacion explicita existente. No se procesan credenciales ni datos de terceros como observaciones.

## Validacion y publicacion

Tests: `node tools/bmb_longitudinal_test.js`, contratos BMB/reactivo/streaming/recovery y SQL real con los tests de memoria, app y autonomia. CI PostgreSQL incorpora migracion y pruebas nuevas; iOS CI compila los cambios de notificacion, navegacion y presentacion. El harness tiene baseline previa y validacion de scope.

Publicar requiere la conversacion de integracion backend descrita en `AGENTS.md`: aplicar migracion y desplegar funciones coordinadamente, despues distribuir una build iOS. Esta rama no modifica Netlify/Supabase productivos ni TestFlight. Antes de declarar funcionamiento en usuarios reales hay que comprobar ingestion real, ritmo diario, consulta por notificacion y respuesta en iPhone. La evaluacion con proveedor real acredita los casos sinteticos descritos abajo; la utilidad sobre usuarios reales sigue pendiente.

### Evidencia de desarrollo

- Harness final: 71/71, cero reparaciones y scope sin infracciones frente a baseline1578554; informe ph_1791365905003_81d2a39d. Primera pasada70/71 por gate de release/replay; sin relajar condiciones.
- SQL real: migracion028 y cuatro suites de base de datos correctas en PostgreSQL embebido (PGlite0.5.8 con pgcrypto real); Docker no disponible. CI tambien ejecuta PostgreSQL15.
- Proveedor real gpt-5.6-luna:5/5 casos, siete llamadas/38.851tokens, datos sinteticos, cero mutaciones cloud/push/acciones. Comprueba cuatro noches mas tarde/hipotesis alternativas, datos escasos, respuesta con multiples observaciones, desvio de tema e hipotesis ajenas. Evaluaciones previas detectaron unidades ambiguas y falta de alternativas; corregidos antes del resultado final. Informe tmp/bmb/longitudinal-live-eval.json.
- CI backend37601735737, fuente25e049a: PostgreSQL15, harness y compilacion/tests Android correctos. CI iOS37601185418: pruebas nativas, build Simulator sin firma y suite Home correctos; capturas en curso. El arbol iOS es identico en70cabb9 y25e049a. El primer intento detecto un unwrap en el fixture HTTP nuevo: corregido usando el lector existente de httpBody/httpBodyStream. No es evidencia de distribucion ni de Screen Time fisico.
- Extracciones secundarias invalidas admiten una reparacion acotada del mismo modelo. Tests verifican que no pueda cambiar acciones, intencion ni autoridad de memoria; evita convertir una unidad erronea en una nueva orden.

### Iteracion de planes

El informe puede conservar un experimento de una sola variable, metrica de exito y revision de1–14dias. Sin pregunta pendiente, con evidencia y confianza>=0.7, se convierte en oportunidad del mismo BMB. El permiso actual sigue gobernando cualquier accion; no se habilitan horarios autonomos. Una recomendacion nunca autoriza por si misma una accion. La clave de significado por metrica impide repetir el mismo experimento durante siete dias. Los informes posteriores conservan la recomendacion y leen recibos, outcomes y feedback para revisar resultados, sin equiparar ejecucion con mejora del descanso. Tests incluyen intento de ejecutar una recomendacion sin permiso: rechazado sin crear evento.
