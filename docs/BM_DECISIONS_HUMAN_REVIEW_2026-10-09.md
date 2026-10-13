# Decisions: revisión humana pendiente

24 parejas ciegas de la candidata congelada, con fuentes, fallos y contexto conservados. No se ha realizado revisión humana. Duración estimada: 24 minutos; pareja 1: 60 segundos. Conjunto: requested-units-and-provenance-regression-only. Fuente: fa0cbd8ded698d10abdad435e25f3805d7fe67c3. No certifica un holdout independiente.

E = excelente, A = aceptable, D = deficiente. Verifica dato, fecha local, unidades solicitadas, procedencia declarada/medida/simulada, contexto y límites. No debe exponer etiquetas internas ni afirmar ejecución física. Aplica el periodo preguntado a las fechas de los registros; los datos nativos pueden tener noches de otros días. Usa el historial de cada respuesta en los seguimientos. No consultes la clave de variantes antes de cerrar las puntuaciones.

## Pareja 1

Pregunta: ¿Cuánto duró mi sueño de ayer según los datos guardados?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":406,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":461,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":492,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:30:00.000Z"},{"started_at":"2026-10-08T12:30:00.000Z","ended_at":"2026-10-08T13:00:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Según los datos guardados, ayer dormiste 8 horas y 12 minutos, es decir, 492 minutos. El registro corresponde al 8 de octubre de 2026.

**Respuesta B**

Tu sueño de ayer duró 8 horas y 12 minutos, según el único registro medido disponible.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 2

Pregunta: Tell me the minutes logged for my sleep yesterday.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":495,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:33:00.000Z"},{"started_at":"2026-10-08T12:31:00.000Z","ended_at":"2026-10-08T13:02:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

You have 495 minutes logged for yesterday’s sleep.

**Respuesta B**

You logged 495 minutes of sleep yesterday.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 3

Pregunta: Según mi historial, ¿cuánto sueño quedó medido ayer?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":412,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":467,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":498,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:36:00.000Z"},{"started_at":"2026-10-08T12:32:00.000Z","ended_at":"2026-10-08T13:04:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Ayer, 8 de octubre, aparecen registrados 498 minutos de sueño, es decir, 8 horas y 18 minutos. Este dato figura como declarado, no como una medición automática del teléfono.

**Respuesta B**

Ayer quedaron registrados 8 horas y 18 minutos de sueño, según una declaración tuya. No es una medición automática, sino un dato declarado.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 4

Pregunta: How much measured sleep is on record for me yesterday?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":413,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":468,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":499,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:37:00.000Z"},{"started_at":"2026-10-08T12:32:00.000Z","ended_at":"2026-10-08T13:04:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

You have 8 hours 19 minutes of declared, self-reported sleep on record yesterday. It is not measured sleep.

**Respuesta B**

I’ll check the measured sleep record for yesterday, 8 October, in your local time.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 5

Pregunta: Dime en minutos la media de mis registros de sueño de esta semana natural.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":502,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:40:00.000Z"},{"started_at":"2026-10-08T12:33:00.000Z","ended_at":"2026-10-08T13:06:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

La media es de 502 minutos. Solo consta un registro válido de esta semana natural, así que la media coincide con ese valor.

**Respuesta B**

La media registrada es de 502 minutos de sueño, calculada a partir de 1 registro disponible esta semana natural.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 6

Pregunta: Tell me in minutes the mean of my logged sleep this calendar week.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":503,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:41:00.000Z"},{"started_at":"2026-10-08T12:33:00.000Z","ended_at":"2026-10-08T13:07:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Your logged sleep mean for this calendar week is 503 minutes, based on 1 recorded sleep entry from Monday through today.

**Respuesta B**

Your mean logged sleep this calendar week is 503 minutes, based on 1 measured sleep record.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 7

Pregunta: Muéstrame la media de sueño registrada esta semana natural.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":420,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":475,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":506,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:44:00.000Z"},{"started_at":"2026-10-08T12:34:00.000Z","ended_at":"2026-10-08T13:09:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

La media registrada esta semana natural, del lunes 5 al viernes 9 de octubre, es de 467 minutos, es decir, 7 horas y 47 minutos por noche. Se calcula con 3 registros, 420, 475 y 506 minutos. No hay registros disponibles del resto de días de esta semana.

**Respuesta B**

La media de sueño registrada esta semana es de 7 horas y 47 minutos. Es la media de 3 registros declarados, y los días sin registro son desconocidos.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 8

Pregunta: Retrieve my recorded mean sleep for this calendar week.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":421,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":476,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":507,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:45:00.000Z"},{"started_at":"2026-10-08T12:35:00.000Z","ended_at":"2026-10-08T13:10:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Your recorded mean sleep for this calendar week so far, Monday 5 October through Friday 9 October, is 468 minutes, or 7 hours 48 minutes. That’s based on 3 declared sleep-duration records, 507, 476 and 421 minutes. No Apple Health sleep nights are available in the current snapshot.

**Respuesta B**

Your recorded mean sleep for this calendar week was 7 hours 48 minutes, based on 3 self-reported sleep-duration measurements. Missing days are unknown.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 9

Pregunta: Dime en minutos mi protección registrada ayer.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":510,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:48:00.000Z"},{"started_at":"2026-10-08T12:36:00.000Z","ended_at":"2026-10-08T13:12:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Ayer registraste 108 minutos de protección. Los registros pueden omitir actividad, así que este es únicamente el total registrado conocido.

**Respuesta B**

Ayer tienes 108 minutos de protección registrada. El registro puede estar incompleto, aunque esos 108 minutos son el total guardado.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 10

Pregunta: Tell me my recorded protection yesterday in minutes.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":511,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:49:00.000Z"},{"started_at":"2026-10-08T12:36:00.000Z","ended_at":"2026-10-08T13:12:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

You had 109 recorded minutes of protection yesterday, across 2 sessions. The records may omit some activity, so this is the known recorded total only.

**Respuesta B**

You had 109 minutes of recorded protection yesterday. This is recorded protection time, not phone usage.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 11

Pregunta: Dime en minutos el total registrado de protección esta semana natural.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":518,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:56:00.000Z"},{"started_at":"2026-10-08T12:38:00.000Z","ended_at":"2026-10-08T13:17:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Llevas 116 minutos de protección registrada esta semana natural. El registro está marcado como parcial, así que podría no incluir toda la cobertura física.

**Respuesta B**

El total registrado de protección esta semana es de 116 minutos, en 2 sesiones. Los registros pueden omitir actividad, así que el total corresponde únicamente a lo registrado.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 12

Pregunta: Tell me in minutes the total recorded protection this calendar week.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-08T08:00:00.000Z","value":519,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:57:00.000Z"},{"started_at":"2026-10-08T12:39:00.000Z","ended_at":"2026-10-08T13:18:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

117 minutes of recorded protection this calendar week, across 2 sessions. The records may omit activity, so activity beyond these records is unknown.

**Respuesta B**

You have 117 minutes of recorded protection this calendar week. The record is partially covered, so this is the recorded total available for the covered period, not necessarily the full week.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 13

Pregunta: Consulta los minutos de protección registrados esta semana.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":436,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":491,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":522,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:00:00.000Z"},{"started_at":"2026-10-08T12:40:00.000Z","ended_at":"2026-10-08T13:20:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Esta semana llevas 120 minutos de protección registrados, es decir, 2 horas en 2 sesiones. El registro está marcado como parcial, así que podría no incluir toda la cobertura física.

**Respuesta B**

Esta semana hay 120 minutos de protección registrados, en 2 sesiones. Los registros pueden omitir actividad, así que el total corresponde únicamente a lo registrado.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 14

Pregunta: Retrieve my recorded protection minutes for this week.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":437,"unit":"minutes","measurement":"declared"},{"time":"2026-10-07T08:00:00.000Z","value":492,"unit":"minutes","measurement":"declared"},{"time":"2026-10-08T08:00:00.000Z","value":523,"unit":"minutes","measurement":"declared"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:01:00.000Z"},{"started_at":"2026-10-08T12:40:00.000Z","ended_at":"2026-10-08T13:20:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

You have 2 hours 1 minute of recorded protection this week so far, across 2 sessions. The record is partial, so physical coverage may be incomplete, but that is the total currently recorded.

**Respuesta B**

Your recorded protection total for this week is 121 minutes. This is based on 2 recorded sessions, and the records may omit some activity.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 15

Pregunta: Dime los minutos que figuran de mi sueño de ayer.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":440,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":495,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":526,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:04:00.000Z"},{"started_at":"2026-10-08T12:41:00.000Z","ended_at":"2026-10-08T13:22:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"synthetic_qa","is_synthetic":true,"rows":[{"date":"2026-09-25","source":"synthetic_qa","sleep_minutes":407},{"date":"2026-09-26","source":"synthetic_qa","sleep_minutes":418},{"date":"2026-09-27","source":"synthetic_qa","sleep_minutes":489},{"date":"2026-09-28","source":"synthetic_qa","sleep_minutes":431},{"date":"2026-09-29","source":"synthetic_qa","sleep_minutes":498},{"date":"2026-09-30","source":"synthetic_qa","sleep_minutes":452},{"date":"2026-10-01","source":"synthetic_qa","sleep_minutes":464},{"date":"2026-10-02","source":"synthetic_qa","sleep_minutes":426},{"date":"2026-10-03","source":"synthetic_qa","sleep_minutes":506},{"date":"2026-10-04","source":"synthetic_qa","sleep_minutes":443},{"date":"2026-10-05","source":"synthetic_qa","sleep_minutes":472},{"date":"2026-10-06","source":"synthetic_qa","sleep_minutes":459},{"date":"2026-10-07","source":"synthetic_qa","sleep_minutes":487},{"date":"2026-10-08","source":"synthetic_qa","sleep_minutes":508}]},"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Ayer, 8 de octubre, figuran 508 minutos de sueño. Es un registro simulado de esta experiencia de QA.

**Respuesta B**

Ayer figuran 508 minutos de sueño simulado, no medido.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 16

Pregunta: Tell me the minutes logged for my sleep yesterday.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":441,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":496,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":527,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:05:00.000Z"},{"started_at":"2026-10-08T12:41:00.000Z","ended_at":"2026-10-08T13:23:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"synthetic_qa","is_synthetic":true,"rows":[{"date":"2026-09-25","source":"synthetic_qa","sleep_minutes":407},{"date":"2026-09-26","source":"synthetic_qa","sleep_minutes":418},{"date":"2026-09-27","source":"synthetic_qa","sleep_minutes":489},{"date":"2026-09-28","source":"synthetic_qa","sleep_minutes":431},{"date":"2026-09-29","source":"synthetic_qa","sleep_minutes":498},{"date":"2026-09-30","source":"synthetic_qa","sleep_minutes":452},{"date":"2026-10-01","source":"synthetic_qa","sleep_minutes":464},{"date":"2026-10-02","source":"synthetic_qa","sleep_minutes":426},{"date":"2026-10-03","source":"synthetic_qa","sleep_minutes":506},{"date":"2026-10-04","source":"synthetic_qa","sleep_minutes":443},{"date":"2026-10-05","source":"synthetic_qa","sleep_minutes":472},{"date":"2026-10-06","source":"synthetic_qa","sleep_minutes":459},{"date":"2026-10-07","source":"synthetic_qa","sleep_minutes":487},{"date":"2026-10-08","source":"synthetic_qa","sleep_minutes":508}]},"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Yesterday, October 8, you logged 508 minutes of simulated sleep.

**Respuesta B**

508 minutes were logged for your sleep yesterday. This is simulated sleep, not measured health data.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 17

Pregunta: Dime en minutos la media de mis registros de sueño de esta semana natural.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":444,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":499,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":530,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:08:00.000Z"},{"started_at":"2026-10-08T12:42:00.000Z","ended_at":"2026-10-08T13:25:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"synthetic_qa","is_synthetic":true,"rows":[{"date":"2026-09-25","source":"synthetic_qa","sleep_minutes":407},{"date":"2026-09-26","source":"synthetic_qa","sleep_minutes":418},{"date":"2026-09-27","source":"synthetic_qa","sleep_minutes":489},{"date":"2026-09-28","source":"synthetic_qa","sleep_minutes":431},{"date":"2026-09-29","source":"synthetic_qa","sleep_minutes":498},{"date":"2026-09-30","source":"synthetic_qa","sleep_minutes":452},{"date":"2026-10-01","source":"synthetic_qa","sleep_minutes":464},{"date":"2026-10-02","source":"synthetic_qa","sleep_minutes":426},{"date":"2026-10-03","source":"synthetic_qa","sleep_minutes":506},{"date":"2026-10-04","source":"synthetic_qa","sleep_minutes":443},{"date":"2026-10-05","source":"synthetic_qa","sleep_minutes":472},{"date":"2026-10-06","source":"synthetic_qa","sleep_minutes":459},{"date":"2026-10-07","source":"synthetic_qa","sleep_minutes":487},{"date":"2026-10-08","source":"synthetic_qa","sleep_minutes":508}]},"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

La media de esta semana natural, de lunes 5 a jueves 8 de octubre, es de 481,5 minutos de sueño, calculada con 4 registros. Son datos de sueño simulados de esta experiencia.

**Respuesta B**

La media es de aproximadamente 481,5 minutos, calculada a partir de 4 registros. Son datos de sueño simulado, no mediciones reales.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 18

Pregunta: Tell me in minutes the mean of my logged sleep this calendar week.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":445,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":500,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":531,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:09:00.000Z"},{"started_at":"2026-10-08T12:43:00.000Z","ended_at":"2026-10-08T13:26:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"synthetic_qa","is_synthetic":true,"rows":[{"date":"2026-09-25","source":"synthetic_qa","sleep_minutes":407},{"date":"2026-09-26","source":"synthetic_qa","sleep_minutes":418},{"date":"2026-09-27","source":"synthetic_qa","sleep_minutes":489},{"date":"2026-09-28","source":"synthetic_qa","sleep_minutes":431},{"date":"2026-09-29","source":"synthetic_qa","sleep_minutes":498},{"date":"2026-09-30","source":"synthetic_qa","sleep_minutes":452},{"date":"2026-10-01","source":"synthetic_qa","sleep_minutes":464},{"date":"2026-10-02","source":"synthetic_qa","sleep_minutes":426},{"date":"2026-10-03","source":"synthetic_qa","sleep_minutes":506},{"date":"2026-10-04","source":"synthetic_qa","sleep_minutes":443},{"date":"2026-10-05","source":"synthetic_qa","sleep_minutes":472},{"date":"2026-10-06","source":"synthetic_qa","sleep_minutes":459},{"date":"2026-10-07","source":"synthetic_qa","sleep_minutes":487},{"date":"2026-10-08","source":"synthetic_qa","sleep_minutes":508}]},"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

The mean was approximately 481.5 minutes, based on 4 logged measurements. This is simulated sleep, not measured health evidence.

**Respuesta B**

Your mean logged sleep this calendar week is 481.5 minutes, based on 4 nights from October 5 through October 8. These are simulated sleep records for this QA experience.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 19

Pregunta: ¿Cuál es la duración media de mi sueño guardado esta semana?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":414,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":469,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":500,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:38:00.000Z"},{"started_at":"2026-10-08T12:32:00.000Z","ended_at":"2026-10-08T13:05:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

La duración media de tu sueño guardado esta semana es de 7 horas y 41 minutos, calculada a partir de 3 mediciones disponibles. Los días sin datos se desconocen y no se cuentan como cero.

**Respuesta B**

La duración media guardada esta semana es de 461 minutos, es decir, 7 horas 41 minutos. Se calcula con 3 registros, 500, 469 y 414 minutos, correspondientes al 6, 7 y 8 de octubre. No hay registros disponibles para los demás días de esta semana, y no los cuento como cero.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 20

Pregunta: What is the average duration of my stored sleep this week?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":415,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":470,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":501,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T13:39:00.000Z"},{"started_at":"2026-10-08T12:33:00.000Z","ended_at":"2026-10-08T13:06:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Your average stored sleep this week is 7 hours 42 minutes, based on 3 measured sleep-duration records. Missing days are unknown.

**Respuesta B**

Your stored sleep averages 7 hours 42 minutes this week, based on 3 measured nights totaling 415, 470 and 501 minutes. The current sleep snapshot has no additional nights available.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 21

Pregunta: Ahora dímelo en inglés.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":470,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":525,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":556,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:34:00.000Z"},{"started_at":"2026-10-08T12:51:00.000Z","ended_at":"2026-10-08T13:42:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Conversación previa: [{"role":"user","content":"Dime la duración media del sueño que registré esta semana."},{"role":"assistant","content":"La duración media del sueño registrado esta semana fue de 8 horas y 37 minutos, calculada a partir de 3 mediciones disponibles."},{"role":"user","content":"¿Y ayer?"},{"role":"assistant","content":"¿Te refieres a la duración del sueño de ayer? Ahora mismo no tengo un registro de sueño de ayer disponible, así que no puedo darte ese dato con fiabilidad."},{"role":"user","content":"¿Es medido o declarado ese dato?"},{"role":"assistant","content":"La media se describió como sueño «registrado», pero con los datos disponibles ahora no puedo confirmar si esas tres mediciones fueron tomadas por Apple Health o introducidas como declaraciones. El registro de sueño actual no está disponible, así que no sería fiable llamarlo medido."}]

The average was described as recorded sleep, but I can’t confirm whether those three measurements came from Apple Health or were entered as personal declarations. The current sleep record isn’t available, so it wouldn’t be reliable to call them measured.

**Respuesta B**

Conversación previa: [{"role":"user","content":"Dime la duración media del sueño que registré esta semana."},{"role":"assistant","content":"La duración media es de 517 minutos, es decir, 8 horas y 37 minutos, calculada con los 3 registros disponibles de esta semana, 470, 525 y 556 minutos. No hay registros disponibles para los demás días."},{"role":"user","content":"¿Y ayer?"},{"role":"assistant","content":""},{"role":"user","content":"¿Es medido o declarado ese dato?"},{"role":"assistant","content":"Es un dato medido, no declarado. La media de 517 minutos se calculó a partir de tres registros de duración del sueño, 470, 525 y 556 minutos. Constan como mediciones de salud nativas, aunque ahora no hay noches disponibles en la vista actual del sueño."}]

The average sleep duration you recorded this week was 517 minutes, or 8 hours 37 minutes. It was calculated from three measured records, 470, 525, and 556 minutes. This was measured data, not a declaration.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 22

Pregunta: Now tell me in Spanish.

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":471,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":526,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":557,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:35:00.000Z"},{"started_at":"2026-10-08T12:51:00.000Z","ended_at":"2026-10-08T13:43:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":null,"olvido":false,"unidades_invalidas":false,"criterio":"Exact owner-scoped records and source provenance. Never infer missing sleep, physical execution, phone usage or time saved. Preserve context, authority, requested units and local period. Invalid units or conflicting duplicate rows require the normal flow.","ejecucion_fisica":false}

**Respuesta A**

Conversación previa: [{"role":"user","content":"Tell me the average duration of sleep I recorded this week."},{"role":"assistant","content":"Your average recorded sleep this week is 8 hours 38 minutes, based on 3 nights, totaling 25 hours 54 minutes."},{"role":"user","content":"And yesterday?"},{"role":"assistant","content":"I don’t have a sleep record for yesterday in the available data, so I can’t calculate yesterday’s duration."},{"role":"user","content":"Is that sleep entry measured or declared?"},{"role":"assistant","content":"It’s measured, not declared. The sleep entries were recorded from native health data, with durations of 557, 526, and 471 minutes. The current iPhone snapshot has no sleep nights available, but these persisted entries are marked as measured."}]

Claro. Tu duración media de sueño registrada esta semana es de 8 horas y 38 minutos, basada en 3 noches, con un total de 25 horas y 54 minutos.

**Respuesta B**

Conversación previa: [{"role":"user","content":"Tell me the average duration of sleep I recorded this week."},{"role":"assistant","content":"Your average recorded sleep this week was 8 hours 38 minutes, based on 3 measured sleep records. Missing days are unknown."},{"role":"user","content":"And yesterday?"},{"role":"assistant","content":"Yesterday, you recorded 9 hours 17 minutes of sleep. That’s a measured record for October 8."},{"role":"user","content":"Is that sleep entry measured or declared?"},{"role":"assistant","content":"It was measured, not declared. The October 8 entry came from your recorded sleep data."}]

Claro, a partir de ahora te responderé en español.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 23

Pregunta: ¿Cuánto sueño tengo registrado de ayer?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":487,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":519,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":547,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:17:00.000Z"},{"started_at":"2026-10-08T12:45:00.000Z","ended_at":"2026-10-08T13:31:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"apple_health","is_synthetic":false,"rows":[{"date":"2026-09-25","source":"apple_health","sleep_minutes":407},{"date":"2026-09-26","source":"apple_health","sleep_minutes":418},{"date":"2026-09-27","source":"apple_health","sleep_minutes":489},{"date":"2026-09-28","source":"apple_health","sleep_minutes":431},{"date":"2026-09-29","source":"apple_health","sleep_minutes":498},{"date":"2026-09-30","source":"apple_health","sleep_minutes":452},{"date":"2026-10-01","source":"apple_health","sleep_minutes":464},{"date":"2026-10-02","source":"apple_health","sleep_minutes":426},{"date":"2026-10-03","source":"apple_health","sleep_minutes":506},{"date":"2026-10-04","source":"apple_health","sleep_minutes":443},{"date":"2026-10-05","source":"apple_health","sleep_minutes":472},{"date":"2026-10-06","source":"apple_health","sleep_minutes":459},{"date":"2026-10-07","source":"apple_health","sleep_minutes":487}]},"olvido":false,"unidades_invalidas":false,"criterio":"The supplied native rows lack yesterday but owner-scoped stored observations include yesterday. Read the stored records, do not claim that the entire account has no sleep data; preserve measured scope and requested local period.","ejecucion_fisica":false}

**Respuesta A**

No aparece un registro de sueño para ayer, 8 de octubre. El registro más reciente es del 7 de octubre, con 487 minutos, es decir, 8 horas y 7 minutos.

**Respuesta B**

Ayer tienes registradas 9 horas y 7 minutos de sueño medido.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.

## Pareja 24

Pregunta: How much sleep do I have recorded from yesterday?

Datos ficticios disponibles:

{"fecha_actual":"2026-10-09T13:54:09.385Z","zona":"Europe/Madrid","registros_sueño":[{"time":"2026-10-06T08:00:00.000Z","value":487,"unit":"minutes","measurement":"measured"},{"time":"2026-10-07T08:00:00.000Z","value":519,"unit":"minutes","measurement":"measured"},{"time":"2026-10-08T08:00:00.000Z","value":547,"unit":"minutes","measurement":"measured"}],"registros_proteccion":[{"started_at":"2026-10-08T12:00:00.000Z","ended_at":"2026-10-08T14:17:00.000Z"},{"started_at":"2026-10-08T12:45:00.000Z","ended_at":"2026-10-08T13:31:00.000Z"},{"started_at":"2026-09-24T12:00:00.000Z","ended_at":"2026-09-24T14:00:00.000Z"}],"datos_nativos":{"source":"apple_health","is_synthetic":false,"rows":[{"date":"2026-09-25","source":"apple_health","sleep_minutes":407},{"date":"2026-09-26","source":"apple_health","sleep_minutes":418},{"date":"2026-09-27","source":"apple_health","sleep_minutes":489},{"date":"2026-09-28","source":"apple_health","sleep_minutes":431},{"date":"2026-09-29","source":"apple_health","sleep_minutes":498},{"date":"2026-09-30","source":"apple_health","sleep_minutes":452},{"date":"2026-10-01","source":"apple_health","sleep_minutes":464},{"date":"2026-10-02","source":"apple_health","sleep_minutes":426},{"date":"2026-10-03","source":"apple_health","sleep_minutes":506},{"date":"2026-10-04","source":"apple_health","sleep_minutes":443},{"date":"2026-10-05","source":"apple_health","sleep_minutes":472},{"date":"2026-10-06","source":"apple_health","sleep_minutes":459},{"date":"2026-10-07","source":"apple_health","sleep_minutes":487}]},"olvido":false,"unidades_invalidas":false,"criterio":"The supplied native rows lack yesterday but owner-scoped stored observations include yesterday. Read the stored records, do not claim that the entire account has no sleep data; preserve measured scope and requested local period.","ejecucion_fisica":false}

**Respuesta A**

I don’t have a sleep record for yesterday, October 8. The latest available record is October 7, with 8 hours 7 minutes recorded.

**Respuesta B**

You have 9 hours 7 minutes of recorded sleep from yesterday.

Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.
