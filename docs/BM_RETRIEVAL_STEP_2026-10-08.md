# Experimento: quitar una decisión de lectura manteniendo la calidad

Guillem autoriza implementar el 2026-10-08. Hipótesis: el tiempo que ahorramos al
quitar un paso supera el tiempo que añade el clasificador, manteniendo la calidad
del output. Este ensayo usa Decisions; no constituye una nueva prueba de Jev.

## Qué cambia

Actual: BM decide qué leer → servidor consulta datos → BM redacta.
Experimental: Decisions elige una consulta cerrada → servidor consulta los mismos
datos autorizados → BM redacta directamente. El generador gpt-5.6-luna y su esquema,
validadores, almacenamiento durable y streaming siguen siendo los mismos.

Solo cuatro preguntas acotadas: duración de sueño registrada ayer, promedio de las
mediciones de sueño de esta semana natural, minutos registrados de protección ayer
o esta semana. Periodos y consultas los construye el servidor desde fecha/zona
horaria; el clasificador no suministra SQL, identidad, parámetros abiertos ni acciones.
Decisions gpt-6-luna responde cinco predicados en una petición. Elegibilidad >=.98,
una ruta >=.95 y las demás <.1; umbrales fijados antes de ejecutar.

El servidor recupera fuentes normales con dueño/corte de olvido/consentimiento,
exige página completa y aporta datos y límites al mismo generador. Esa llamada
debe terminar como respuesta a pregunta, sin acción, propuesta, memoria, observación,
seguimiento ni nueva consulta. Si no cumple, se descarta y se usa el flujo habitual.
No se fuerza una respuesta numérica cuando faltan datos. El sistema distingue
ausencia de medición de cero sueño, y protección registrada de uso del teléfono.

Flag BM_RETRIEVAL_STEP_QA_ENABLED apagado por defecto; solo URL QA fija,
allowlist de servidor y usuarios con metadata sintética comprobada. Clasificación
y comprobación de identidad: timeout total 1000ms; lectura: 800ms; sin reintento.
Solicitudes proactivas o con propuesta/petición pendiente mantienen el flujo habitual.
Flags Jev y primer experimento Decisions apagados en ambos grupos.

## Cómo se mide

Baseline ecaad60, candidato inicial 75d046c; hashes reales guardados al inicio y
verificados al cierre. Manifiesto de20preguntas redactado antes de ejecutar, diez
ES/diez EN, veinte parejas con orden AB/BA equilibrado por idioma. Una repetición;
no corpus de validación independiente ni revisión humana. Fixtures se restablecen
idénticos antes de cada variante y token se renueva por pareja.

Datos sintéticos conocidos: sueño medido420/480/450min en tres días, preguntas sin
mediciones y filas anteriores a un corte de olvido. Protección con dos sesiones
solapadas cuya unión es90min, una sesión antigua fuera de rango y fixtures vacíos
con0min registrados. Promedio solo sobre mediciones disponibles dentro de la semana.
Respuesta correcta debe preservar valor, unidad, periodo, idioma y límites de datos.

Handlers locales exactos, proveedor y BD QA reales. Primer texto se reinicia cuando
el generador descarta un borrador; se mide el primer texto del intento final, desde
el inicio completo del turno. Final incluye commit durable. Todos los errores y
consumos por petición, reparaciones/cache reads/cache writes quedan registrados.
Tarifas de referencia documentadas2026-10-07; estimación, no factura. Timeouts sin
usage dejan coste total desconocido. Revisión automática por otro modelo recibe
los valores exactos y límites del fixture; no sustituye una validación humana.

Éxito preliminar requiere menor mediana primer texto/final, menos llamadas
generativas, menor coste completo, no más errores y las veinte respuestas del
candidato aceptables/correctas por revisión semántica, sin contradicción/ejecución
inventada. El ensayo no habilita producción ni certifica iPhone o calidad general.

## Resultado

Prueba terminada: mejora de mediana y llamadas, calidad todavía insuficiente para
activar. Prototipo apagado; no deploy, migración, flags del servidor ni TestFlight.

| Métrica | Actual | Ruta experimental |
| --- | ---: | ---: |
| Primer texto p50 | 10091,04ms | 6061,01ms (-39,9%) |
| Respuesta durable p50 | 11109,47ms | 7139,70ms (-35,7%) |
| Primer texto p95 | 13709,36ms | 13599,36ms (-0,8%) |
| Respuesta durable p95 | 14660,74ms | 14882,57ms (+1,5%) |
| Llamadas generativas | 61 | 41, más20Decisions |
| Turnos completados / fallos funcionales | 20 / 0 | 20 / 0 |
| Respuestas aceptables por segundo modelo | 16/20 | 17/20 |
| Coste estimado registrado | $0,03719605 | mínimo$0,02727950 |

Son preguntas de recuperación deliberadamente seleccionadas; estos10s del baseline
no representan la mediana general de Blankmind ni se comparan directamente con el
corpus amplio del experimento anterior. Una repetición por pregunta no demuestra
significancia, causalidad de cada diferencia individual ni rendimiento en producción.

Clasificación completada18/20, dos timeouts sin usage: total candidato desconocido,
no afirmar ahorro completo. El subtotal conocido es26,7% menor. Diez de las veinte
preguntas usaron el recorrido final-only: nueve necesitaron una sola generación y
una necesitó dos por la reparación de conformidad existente. Las restantes
conservaron el flujo normal por timeout o abstención.
El total ahorra20generativas. Los casos descartados están incluidos en la comparación.

Calidad: tres respuestas candidatas deficientes frente a cuatro baseline; un caso
que baseline resolvió correctamente fue incorrecto en candidato. Errores candidatos:
promedio semanal calculado con2de3mediciones (465en vez de450min, en fallback),
retener el total computable0min de protección semanal (en recorrido acelerado) y
retener0min de protección ayer (en fallback). Por tanto la hipótesis completa con
calidad mantenida no pasa, aunque la calidad agregada del juez sea algo mejor.
No contar HTTP200 o ausencia de acciones como corrección semántica.

La primera revisión omitía fecha actual/conteo de sesiones y marcaba como inventados
datos suministrados al generador. Se corrigió el contexto del revisor con reloj,
periodos locales,2/0sesiones y cobertura parcial real del fixture. Ambas revisiones
se conservan completas; se volvieron a evaluar las40respuestas, sin modificar ninguna
salida ni el runtime. Es revisión automática, no validación humana independiente.

Los resultados sugieren un problema de interpretación: no tener sesiones guardadas
sí permite computar0min *registrados*, mientras que la actividad física total puede
ser desconocida. El experimento mantiene visibles esos fallos; no se ajustaron
umbrales ni instrucciones de generación después de observar los resultados.

Fuentes congeladas9/9hashes iguales al cierre. Limpieza QA5/5. Unit tests cubren dueño,
corte de olvido, página incompleta, cero real, DST, presupuesto recuperado ante salida
inválida y una sola generación atravesando el planner real. Harness inicial78/78/scope.

[Evidencia de todas las parejas, consumos y revisiones](BM_RETRIEVAL_STEP_EVIDENCE_2026-10-08.json)
· [PR27](https://github.com/guillemarcos14/BlankmindAI/pull/27).

Referencia: [Decisions API](https://developers.openai.com/api/docs/guides/decisions).
