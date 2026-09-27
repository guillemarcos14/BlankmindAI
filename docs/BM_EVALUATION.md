# BM: evaluación semántica y replay

## Gate de release v3

El resultado del gate separa unidades que antes podían confundirse: **grupos de checks**, **conversaciones únicas**, **turnos únicos**, repeticiones, incidentes históricos y casos físicos. Un `17/17` significa únicamente que aprobaron 17 grupos automatizados; no significa 17 conversaciones ni una release validada.

`tools/bm_evaluator_integrity_gate.js` reproduce seis fallos observados en WhatsApp y muta cada condición que los detecta. Solo aprueba si el comportamiento correcto pasa y todos los mutantes fallan. `tools/bm_action_envelope_contract_test.js` verifica los campos canónicos de una acción y conserva `activate_mode`/`switch_mode` únicamente como entradas de migración, nunca como dominio productivo. `tools/bm_autonomous_messaging_test.js` exige que WhatsApp/SMS guarde la orden sobre la única selección de distracciones y que el bloqueo permanezca pendiente hasta que la persona pulse la notificación; si falta la selección, el toque abre el selector y la aplicación ocurre al aceptar.

La autorización final es independiente: `tools/bm_release_readiness_gate.js` exige el commit, deploy backend, build iOS y hash del artefacto exactos; 200 conversaciones únicas con modelo activo y juez independiente; y 20 casos físicos con trazas, estado observado y evidencia enlazada al mismo candidato. Si falta cualquiera de esas pruebas, `production_release_verified` permanece en `false`; ningún promedio puede compensarlo.

```powershell
node tools/bm_evaluator_integrity_gate.js
node tools/bm_action_envelope_contract_test.js
node tools/bm_autonomous_messaging_test.js
node tools/bm_release_readiness_gate.js --init --evidence tmp/bm-release/evidence.json
node tools/bai_release_gate.js --quality-judge --dataset tools/datasets/<release-set>.json --reviews tools/datasets/<release-reviews>.json --release-evidence tmp/bm-release/evidence.json
```

El dataset de release debe contener al menos 200 conversaciones realmente distintas; repetir seis conversaciones no aumenta esa cobertura. La plantilla generada es evidencia por completar, no evidencia válida. Los incidentes históricos son reconstrucciones de fallos observados; evitan regresiones conocidas, pero no sustituyen una ejecución física nueva.

El gate mide trayectorias textuales con expectativas: deduplica la secuencia ordenada de inputs (Unicode NFC, minúsculas y espacios normalizados) y expectativas completas. IDs, canales, modos, repeticiones y contexto sin un cambio observable en el gold no aumentan el conteo; los turnos únicos son la suma de turnos de esas secuencias. Exige `runs` completos y contadores coherentes con ellos. Este conteo reproducible no demuestra diversidad semántica: una auditoría independiente debe descartar variaciones superficiales de redacción, horas o valores y declarar las bases y combinaciones reales del corpus.

## Juez independiente de calidad

La exactitud dura sigue perteneciendo al oracle determinista y a la verificación nativa. La calidad conversacional se revisa aparte con `tools/bm_sol_quality_judge.js`, usando por defecto `gpt-5.6-sol` con razonamiento `low`. Luna genera las respuestas y no autoriza su propia release. Sol puntúa comprensión, continuidad, utilidad, naturalidad y concisión. Tras confirmación conversacional, pedir abrir Blankmind o una segunda confirmación cuando existe selección exacta es fallo duro. Afirmar éxito antes del acuse positivo del dispositivo también suspende el caso.

El juez conoce el contrato real de activación: la petición conversacional crea una orden pendiente y el toque de la notificación autoriza la ejecución nativa. Sus resultados no sustituyen el oracle, la compilación ni la prueba física. El gate completo se ejecuta con `node tools/bai_release_gate.js --save --count 125 --quality-judge`; exige clave API y guarda `tmp/bm-semantic/sol-quality-release-gate.json`. Con `--production` evalúa además las respuestas obtenidas del endpoint desplegado y guarda `tmp/bm-semantic/sol-quality-deployed-gate.json`.

## 1. Qué demuestra cada resultado

`tools/bm_semantic_oracle.js` no importa el parser, reducer, renderer ni actionGate de BM. Compara hechos esperados escritos en el dataset con el estado y la acción obtenidos. Comprueba intención, slots, decisión, transición, procedencia/confianza, confirmación, permisos, presencia, acciones prematuras y contradicciones visibles. Las acciones se comparan completas salvo identificadores y etiquetas de presentación; no basta con acertar `type` o una hora.

Los resultados posibles son `passed`, `failed` y `unverified`. **Solo `passed` permite release.** No existe una media de naturalidad que compense un horario incorrecto. Las métricas blandas (longitud, frases y repetición) son descriptivas y aparecen separadas.

Las expresiones regulares solo pueden rechazar contradicciones evidentes. No pueden certificar el significado de una respuesta arbitraria. Para aprobar la equivalencia visible, el evaluador exige una revisión independiente vinculada mediante SHA-256 al conjunto exacto de superficies visibles y a la expectativa completa. Un texto absurdo con las palabras correctas queda `unverified` y bloquea release. El evaluador no convierte automáticamente una revisión pendiente en éxito.

Las revisiones de otro agente se identifican como tales; no equivalen a revisión humana. El JSON de revisión usa `response_sha256`, `expectation_sha256`, `reviewer`, `rationale`, `verdict` (`equivalent` o `not_equivalent`) y `language`. Ambos hashes se encuentran en `runs[].turns[].review_binding`. Si cambia una hora, aplicación, duración, idioma o cualquier superficie, la revisión anterior deja de valer. No escribir revisiones automáticamente a partir de `status` ni del texto del renderer.

La equivalencia estructural admite únicamente transformaciones que preservan significado: orden de conjuntos de apps/días, campos nulos de acciones, alias públicos `end`/`end_or_duration` y `screen_time_permission`/`permissions`, y duración calculable de un intervalo cerrado. Nunca sobrescribe dos valores explícitos incompatibles para hacerlos coincidir.

También compara los slots `hard_mode` y `requested_capability`. En fixtures anteriores, su ausencia significa `null` (no solicitado), nunca permiso implícito. `hard_mode` debe coincidir con la acción que lo admite; una solicitud de capacidad no soportada o de revisión de información no puede convertirse en bloqueo. `activate_mode` y `switch_mode` solo se aceptan para migrar entradas antiguas a `start_protection`/`open_app_picker`; el producto actual siempre ejecuta sobre la lista canónica de distracciones.

## 2. Ejecución

Desde la raíz del backend:

```powershell
node tools/bm_semantic_oracle_test.js --out tmp/bm-semantic/oracle-mutations.json
node tools/bm_legacy_evaluator_audit.js --out tmp/bm-semantic/legacy-false-positives.json
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_development_v2.json --repeats 2 --concurrency 8 --out tmp/bm-semantic/development.json
```

El replay devuelve código `1` si hay fallos **o equivalencia sin verificar**, y `2` si la configuración/dataset es inválido. El informe siempre conserva los fallos por conversación/turno y continúa las demás conversaciones. Un error de red no se convierte en acierto del fallback.

Para backend local con el modelo activo o un endpoint del planner:

```powershell
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_development_v2.json --model --repeats 3 --concurrency 6 --out tmp/bm-semantic/active-model.json
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_development_v2.json --url https://getblank.netlify.app/.netlify/functions/blanked-agent --repeats 3 --concurrency 6 --out tmp/bm-semantic/endpoint.json
```

`--model` requiere `OPENAI_API_KEY`; no se imprime ni se guarda. `--token-env NOMBRE` permite autorización HTTP por una variable existente. Sin `--model`, el replay local deshabilita llamadas al modelo en ese proceso. `--url` solo llama al planner: nunca usar los webhooks WhatsApp/SMS para replay masivo. El runner rechaza rutas `whatsapp-agent`, `sms-agent` y `assistant-channel`. No ejecuta acciones nativas ni despliega servicios.

Para cientos de conversaciones con concurrencia limitada, comparación de regresiones y revisiones independientes:

```powershell
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_development_v2.json --repeats 40 --concurrency 12 --out tmp/bm-semantic/batch-240.json
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_development_v2.json --reviews tools/datasets/bm_semantic_development_reviews.json --baseline tmp/bm-semantic/development.json --out tmp/bm-semantic/reviewed.json
```

La concurrencia admite 1–64 conversaciones independientes; los turnos de una conversación conservan el orden. Cada repetición empieza sin estado de la repetición anterior. El historial normal de BM conserva ocho mensajes; el control directo recibe el historial completo. El estado canónico real devuelto, nunca el esperado, pasa al siguiente turno. `__REPLAY_NOW__` en `context.app_presence.last_seen_at` significa presencia fresca al inicio de esa conversación; el valor resuelto se envía al planner. Los datasets de presencia caducada usan fechas explícitas.

## 3. Diferencial y observabilidad

```powershell
node tools/bm_semantic_replay.js --dataset tools/datasets/bm_semantic_differential_v2.json --model --differential --repeats 2 --concurrency 6 --out tmp/bm-semantic/live-differential.json
```

Los cinco modos son `direct_model` (conversación normal), `bm_full` (prompt legacy completo), `bm_raw` (JSON del modelo antes del postprocesado), `bm_canonical` y `bm_final`. El adaptador local privado `_evaluation.traceTurn` no se activa mediante un campo de una petición HTTP pública. `--adapter ruta.js` acepta otro adaptador con `traceTurn({prompt,context,mode})`; permite instrumentar un servicio remoto sin inventar respuestas cuando faltan etapas.

`trace.request` conserva el prompt de sistema, el contexto serializado y el schema enviados. `trace.raw_plan`, `action_gate`, `normalized_plan` y `final_plan` pertenecen a **una misma respuesta del modelo**. `layer_changes` identifica en qué transformación cambian acciones o texto. Comparar dos llamadas independientes sin este control mezcla postprocesado con variación del modelo. Los modos canónico y final pueden coincidir por diseño cuando el estado ya genera la respuesta final sin reescritura; esa identidad no demuestra una ablación distinta.

El control directo no produce slots ni acciones estructuradas. Esa falta de instrumentación se registra como `unverified`, no como prueba de que Luna interpretó mal el mensaje. El contenido libre requiere revisión independiente. En los brazos legacy, las acciones observables incorrectas sí fallan aunque no exista estado canónico.

El informe incluye porcentajes separados por dimensión, respuestas completas, estado esperado/obtenido, acciones esperadas/obtenidas, causas probables agrupadas, regresiones respecto de un informe anterior, variación semántica/textual por repetición, fuentes del resultado y hashes de código/dataset. `dataset.sha256` es el hash del JSON canónico; los manifests de holdout usan hash de bytes del archivo, por lo que pueden diferir sin que cambie el contenido.

## 4. Datasets y auditoría del evaluador anterior

`tools/datasets/bm_semantic_development.json` conserva las expectativas iniciales independientes: cinco canales, respuestas elípticas, recurrencia y correcciones de duración; añade una reconstrucción explícitamente etiquetada de la clase duración/hora. No se presenta esa reconstrucción como transcripción real.

Después se revisaron 17 snapshots obtenidos mediante lectura de eventos productivos. `tools/datasets/bm_production_observed_anonymized.json` conserva 14 pares de texto únicos de usuario/asistente, deduplicados de 59 ocurrencias de pares (118 mensajes). Mantiene ventanas de contexto como referencias al texto único y omite ventanas enteramente contenidas. Se eliminaron timestamps e identificadores externos; los textos seguros son exactos, con los marcadores `[link]` ya presentes en la extracción. **Son textos observados en producción; no se ha verificado autoría humana ni el número de conversaciones distintas.** Algunos pueden proceder de smoke tests históricos. No interpretar 17 snapshots, 14 pares o 14 ventanas como igual número de usuarios/conversaciones.

`bm_production_observed_replay.json` toma siete inputs exactos, distribuidos en tres extractos diagnósticos, con expectativas independientes congeladas antes de ejecutar y un contexto WhatsApp sintético declarado. Conserva el texto del asistente productivo en el corpus de procedencia; no lo usa como resultado esperado. El extracto de bloqueo inmediato se inicia expresamente sin estado previo para aislar esa instrucción. Los fragmentos ambiguos o con contexto ya corrompido se conservan en el corpus, pero no reciben expectativas especulativas. Los primeros informes fallidos permanecen como evidencia del estado previo a la reparación.

`bm_semantic_heldout.json` y su manifest fueron escritos por un agente distinto sin leer la implementación del oracle/reducer. Se congelaron antes de su primera ejecución. No modificar sus expectativas para corregir un fallo. Tras revelar sus fallos deja de ser un conjunto oculto nuevo: conservar el primer resultado y crear otro conjunto independiente para una futura release.

Durante la auditoría apareció un requisito que el contrato inicial omitía: iOS/Android/web convierten `duration_days:null` en siete días. Por tanto el estado incorpora `schedule_horizon_days` explícito para programaciones recurrentes. Un fixture v1 sin ese campo significa `null`, nunca siete días. Los datasets v2 especifican el horizonte en el input y lo verifican en estado y acción; los originales y los primeros informes se conservan. Cambiar este contrato debe documentarse como migración de capacidades, no como corrección oculta de asserts.

`tools/bm_legacy_evaluator_audit.js` llama al mismo `assertPlan` usado por la suite y construye seis planes deliberadamente erróneos. El gate actual exige que todos sean rechazados:

| Contraejemplo | Qué protege ahora |
| --- | --- |
| Hora/app/ejecución visibles contradictorias | Revisa todas las superficies visibles, incluida voz y follow-up |
| `blocking_data` distinto de la acción | Compara `blocking_data` con la acción ejecutable |
| Días de recurrencia cambiados | Compara también días y duración |
| Permisos falsos | Comprueba permisos también en la rama de bloqueo |
| Texto absurdo con palabras correctas | Mantiene las comprobaciones semánticas además de las métricas blandas |
| Voz/follow-up contradictorios | Incluye `speech_text` y `followup_text` en las superficies visibles |

Son mutaciones construidas para el evaluador, no respuestas atribuidas al modelo productivo. El informe debe terminar con `false_positives: 0`.

El nuevo test modifica deliberadamente horarios, duración, apps, recurrencia, horizonte, confirmación, procedencia, acción, siguiente paso, idioma y texto. Ejecuta el evaluador real para cada mutante. Las mutaciones de texto arbitrario invalidan la revisión vinculada; se distinguen de los errores semánticos que se detectan directamente. También comprueba 200 trabajos concurrentes con límite real, continuidad de estado y conservación de errores por turno.

## 5. Criterios de release

El juez v8 recibe un contrato de capacidades escrito independientemente y contrastado con el transporte nativo. Distingue ISO lunes=1 en estado canónico de Calendar domingo=1 en acciones; `set_daily_limit` no representa inicio futuro, expiración ni hard mode; un setup presente en `emitted_actions` ya está emitido aunque no aparezca como código en el texto. La cancelación invalida el pendiente del canal sin necesitar una acción explícita, pero no prueba que una protección aplicada haya desaparecido. Estas precisiones no alteran los umbrales ni autorizan éxitos físicos sin acuse. La versión participa en el hash de caché; los resultados del juez anterior se conservan.

El oracle visible diferencia por cláusula una negación, una referencia histórica corroborada, una propuesta ya cancelada y un rango real de capacidad de un valor operativo afirmado. Eliminar un falso positivo sólo devuelve `unverified`, nunca `passed`: sigue exigiendo revisión independiente de texto y voz. Valores ajenos al contexto, contradicciones después de una negación y éxitos sin evidencia mantienen su rechazo.

No aprobar una release si queda cualquier fallo duro, revisión visible pendiente, resultado de modelo ocultado por fallback o gate existente fallido. Exigir coincidencia de estado y siguiente paso, correcciones que invaliden confirmación, acciones equivalentes, cero valores inventados y cero acciones prematuras en desarrollo y un holdout nuevo. Repetir el modelo activo y comprobar que no aparecen variantes semánticas graves.

Los tests de contexto por canal verifican el backend compartido, no la entrega de APNs ni la ejecución en dispositivos. La release necesita además gates de transporte/persistencia, compilación nativa y smoke final real de: push visible sin ejecución silenciosa, activación al pulsar la notificación, acuse verificado, fallo honesto cuando iOS no despierta y selector con aplicación automática cuando falta una selección exacta. WhatsApp/SMS quedan para esos smoke tests finales, nunca para hacer la suite masiva.

No presentar `114/114`, la ausencia de crashes, las métricas blandas o una suite determinista repetida como prueba de comprensión general. La evidencia final debe nombrar dataset, versión de contrato, hash de implementación, fuentes reales, repeticiones, fallos pendientes y alcance de las revisiones independientes.

### Evidencia de esta pasada, 2026-09-15

`docs/BM_EVALUATION_EVIDENCE.json` conserva hashes de informes/código, resultados separados y ejemplos exactos de una misma respuesta antes y después del postprocesado. Los cuatro informes `typed-final-*` corresponden al código final, incluido `bm-semantic-extraction.js`; sus seis hashes de implementación coincidían con los archivos al cerrar esta validación.

| Informe en `tmp/bm-semantic/` | Alcance | Resultado |
| --- | --- | --- |
| `typed-final-batch-240.json` | Seis guiones de desarrollo repetidos 40 veces, concurrencia 12 | 960/960 turnos locales |
| `typed-final-live-24.json` | Dos guiones, tres repeticiones | 24/24 respuestas reales de Luna |
| `typed-final-production-live-21.json` | Siete inputs observados, tres repeticiones; autoría humana no verificada | 21/21 respuestas reales de Luna |
| `typed-final-heldout-v4-live-11.json` | Cinco conversaciones congeladas independientemente, tras su primera ejecución local | 11/11 respuestas reales de Luna |

Las 56 llamadas finales se identificaron como `openai:gpt-5.6-luna:semantic`, sin fallos, equivalencias pendientes ni errores ocultos por fallback. No aparecieron regresiones ni variación semántica/textual en los guiones repetidos. Las revisiones independientes cubren las superficies exactas: ocho combinaciones de desarrollo, cinco del corpus observado y once de v4. Son revisiones de otro agente, no certificación humana.

El informe anterior `final-freeze-production-live-21.json` conserva dos fallos reales de extracción: el modelo devolvió `mornings` dentro de un campo que exigía otra capa de JSON codificado como texto. Aunque el fallback conservaba el estado correcto, el oracle rechazó esos turnos. El runtime sustituyó ese campo por valores JSON tipados; el replay final aprobó las mismas expectativas sin cambiarlas. También permanecen los primeros fallos semánticos del corpus observado y de los holdouts consumidos.

La mutación del evaluador impidió que pasaran **42 errores deliberados**: 40 rechazos directos y dos textos que necesitarían una revisión independiente nueva. El evaluador anterior aceptó los seis contraejemplos. El harness final (`tmp/bm-audit/final-harness.json`) aprobó 25/25 comandos, sin reparaciones ni violaciones de alcance frente a la línea base original. Sus diagnósticos legacy siguen separados y documentados: estos resultados no demuestran que se hayan resuelto todos los casos históricos.

Esta validación llama al planner local con el modelo real; no prueba entrega por proveedores, ejecución nativa ni despliegue productivo. Los resultados favorables del candidato no sustituyen los primeros informes fallidos ni justifican declarar comprensión general o release productiva.

### Revisión independiente del replay local, 2026-09-26

`Codex /root/release_audit` revisó los dos pares nuevos de hashes de respuesta/expectativa del turno «Yes» en `tmp/bm-semantic/final-neutral-copy-review.json`: corrección a 45 minutos una vez y horario corregido de 10:00 a 12:00 cada día durante siete días. Se contrastaron texto, voz, controles, historial, estado, acciones y contexto del dispositivo. Se corrigió antes de aprobar la referencia universal a «iPhone» por «device», porque el mismo texto aparecía en Android y canales sin plataforma conocida. Las dos revisiones se añadieron a `bm_semantic_development_reviews.json` conservando las anteriores y el corpus esperado. Son dos trayectorias lógicas locales distribuidas por canales y repeticiones, sin llamadas al modelo ni turnos de cancelación; no amplían el corpus de 200 trayectorias ni prueban entrega, persistencia cloud o bloqueo físico.
