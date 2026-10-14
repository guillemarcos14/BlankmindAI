# Sistema conversacional y agéntico

## Integración final de esta continuación (2026-10-14)

PR48 reúne CORE32fa44c, retirada iOS-only0af4c63, las correcciones posteriores de PR42 y la separación explícita entre registros de sueño de la cuenta y baseline Watch. Se conservan exactamente dos herramientas, los 15 comandos nativos y el contrato proactivo. El runtime se vincula ahora a ambas migraciones: descanso035 y etiquetas036. Las tres optimizaciones permanecen OFF; los pilotos no son el certificado de 200 pares.

Se eliminó la modificación obligatoria de dos puntos en el planner y en la entrega de texto generado. Las comprobaciones de evidencia, datos simulados, permisos y efectos permanecen; no son reparaciones de estilo. La salida natural no tiene una plantilla nueva.

El aviso futuro del dictamen action-es-start-30 no estaba garantizado: la cola reactiva y su recibo no equivalen a una notificación programada. La herramienta ya describe ese límite y nuevas respuestas reales no prometen el aviso. El dictamen memory-es-forget-4 infravaloraba la redacción transversal de observaciones/revisiones/seguimientos de SQL028, pero eso tampoco prueba el borrado preciso de una categoría que podría abarcar otras claves estables. Se conserva el dictamen original y se aclara el alcance ante ambigüedad; ninguna política de privacidad cambió.

Los primeros dictámenes V3 del piloto integrado criticaron la falta de noches Watch al ver tres observaciones genéricas. V4 añade el rest_evidence realmente enviado al modelo, procedencia y reloj de turno: las mediciones genéricas native_health no acreditan Watch ni siete noches de baseline. Los resultados originales no se sobrescriben ni se convierten en PASS por adjudicación. En otro piloto apareció una ausencia de sueño de cuenta incorrecta; la instrucción final exige consultar observations antes de inferir ausencia desde current_sleep/rest_evidence.

QA njqbovsmoowkhhsqmitn carecía de descanso035 y etiquetas036. Después de inspeccionar versiones/objetos se aplicaron únicamente esas dos migraciones, en una transacción; historia previa y usuarios preservados. No se reaplicaron026–028 ni029/030. La migración productiva035 existente y TestFlight117 pertenecen a la release de descanso anterior; esta continuación no publicó producción.

El medidor admite --paired-voice y mide el reloj continuo desde la entrada del turno hasta el primer PCM de la voz autenticada, después del commit real. Se obtuvo voz ES/EN real en una versión intermedia. Un coste de voz desconocido mantiene cost_usd=null en el informe y retiene la reserva conservadora; nunca se contabiliza como audio gratuito. No hubo reproducción física acreditada ni ampliación de claves, cuotas o suscripción.

El techo acumulado FINAL es40USD en ../Codigo-retrieval/tmp/retrieval-wide/budget.json, compartido y sin contadores reiniciados. Solo un proceso pagado simultáneo; reservas desconocidas conservadas. Las tablas de pruebas SQL se ejecutaron en PostgreSQL desechable; las pruebas pagadas usan identidades sintéticas aisladas con limpieza.

Guillem confirma MacinCloud en el navegador Codex y build117 instalada. Los accesos a navegador y ventanas agotaron tiempo de respuesta repetidamente. Hace falta restaurar ese acceso, distribuir una build compatible con assistant-device y medir permisos, selección, acciones y recibos en iPhone; no se declara probado por disponibilidad del dispositivo.

Evidencia nueva: tmp/agent-eval, tmp/product-harness/final40-baseline.json y final40-integrated.json; paquetes privados de ocho funciones en tmp/cloud-stage. El cierre detalla hashes, gasto, validaciones y los motivos exactos de no activar cada sustitución. Las notas siguientes conservan evidencia histórica y quedan subordinadas a esta integración.


Implementación del esquema aprobado el 14 de octubre de 2026, conservado literalmente en Blank Brain/REFERENCIAS/modelo_conversacional_agentico_fuente_de_verdad.md. Esta guía describe el código y su activación; no redefine el esquema ni el modelo central de descanso.

## Flujo implementado

El agente genera una respuesta compacta o una llamada nativa a una de dos herramientas. consultar_contexto agrupa hasta tres consultas independientes, limita fuentes y páginas y reutiliza lecturas idénticas dentro del turno. gestionar prepara cambios de dispositivo, propuestas, memoria y seguimiento. El servidor conserva la identidad autenticada y valida evidencia literal, parámetros, consentimiento, propuestas, permisos y recibos; el modelo no escribe directamente ni acredita un bloqueo físico.

Las respuestas y la gestión completas requieren una generación cuando no hace falta consultar ni corregir el resultado. Una consulta requiere evidencia nueva y otra generación. No se añade una generación para repetir los argumentos de gestionar: su texto describe el intento y solo se entrega como respuesta definitiva después de la transacción existente de preparación, cola y commit. El iPhone comunica el resultado real por el canal existente. El texto provisional del streaming no ejecuta acciones.

El contexto automático reciente se reduce a ocho turnos al activar tools; el resto sigue accesible desde offset 8. Las memorias, los límites de olvido y la recuperación de propuestas conservan sus controles.

Las herramientas nuevas se limitan a turnos reactivos. El modo proactivo conserva su contrato generativo previo y la decisión silent, aunque tools esté habilitado en QA. Una regresión explícita comprueba esa separación del modelo central.

Las reparaciones de una gestión conservan la herramienta gestionar y la operación/clave de memoria. El schema exige valores y evidencias literales para evitar resumir un valor y tener que regenerarlo. pause_rules tiene una variante con horas enteras obligatorias (1–168) y minutes=null; el validador final conserva sus comprobaciones. No se añade otra llamada para clasificar esas acciones.

## Acciones disponibles

Las acciones de dispositivo conservan exactamente el catálogo nativo actual. No se incorporan comandos que el iPhone no pueda ejecutar.

| Capacidad | Comandos detrás de gestionar |
|---|---|
| Iniciar protección inmediata | start_protection |
| Crear, modificar o eliminar ventanas | apply_schedule, update_schedule, delete_schedule, delete_all_schedules |
| Pausar y reanudar reglas | pause_rules, disable_pause |
| Límite diario, modo de permitidas y filtro adulto | set_daily_limit, disable_daily_limit, enable_allow_only, disable_allow_only, enable_adult_filter, disable_adult_filter |
| Abrir selección de distracciones o solicitar Screen Time | open_app_picker, request_screen_time_permission |

Además, gestionar guarda/corrige/olvida hechos explícitos, guarda propuestas completas y solicitudes pendientes, registra observaciones y resuelve seguimientos con el validador longitudinal existente. Una petición explícita puede ejecutarse sin confirmación redundante; una propuesta requiere aceptación de sus parámetros exactos. Las acciones de configuración que requieren UI abren esa UI.

El borrado conserva la política previa de 028: un tombstone corta la personalización histórica y redacta observaciones, revisiones y seguimientos anteriores. forget selecciona una clave estable; no debe presentarse como un borrado preciso de cualquier categoría de hábitos. forget_all no desactiva la recogida futura, no cambia el consentimiento y no elimina la cuenta. Las peticiones ambiguas necesitan aclaración del alcance. Esta rama no modifica esa política de privacidad.

Terminar/extender una sesión, saltar una única ocurrencia, activar/desactivar individualmente una ventana y modificar permisos autónomos por conversación requieren capacidades nativas o contratos adicionales: no se anuncian como ejecutables. apply_ai_plan sigue siendo un comando histórico ajeno al catálogo del agente nuevo. No se puede exportar uso real por app desde DeviceActivityReport; las estadísticas de protección no equivalen a uso del móvil.

## Sustituciones de Decisions

retrieval sustituye la generación de preparación en consultas acotadas de sueño/protección de ayer o esta semana. Una llamada agrupa elegibilidad, métrica y periodo; el servidor lee y calcula; el generador solo redacta. Se añaden recuentos de sesiones e interrupciones registradas. Duda, negativa, fallo o datos insuficientes devuelven el turno al agente abierto. Nunca decide permisos ni ejecuta.

labels clasifica tema y tipo de hechos nuevos ya extraídos, validados y guardados. No reextrae valores, cambia fechas, convierte declaraciones en mediciones ni recalcula etiquetas antiguas. Se reserva una única clasificación por turno, fuera del camino de la respuesta cuando el host ofrece waitUntil. El streaming API v2 conserva ese contexto. Un reenvío de un turno completado puede recuperar la clasificación omitida, sin repetir el proveedor. Sin host de background, presupuesto o migración, la conversación sigue disponible y el etiquetado se omite.

Las etiquetas son metadatos compartidos en la misma base, vinculados a los hechos originales. Las correcciones y el olvido invalidan incluso clasificaciones en vuelo. El generador recibe únicamente etiquetas pertinentes a sus fuentes. La selección entre propuestas/seguimientos completos y la priorización adicional siguen en la vía abierta: todavía no hay una sustitución acreditada que retire trabajo generativo en esos casos. Añadir un clasificador allí sin retirar trabajo empeoraría el coste.

## Activación y presupuesto

El etiquetado está implementado como capacidad de organización. El generador sigue extrayendo valores y acreditando su procedencia; esta rama no ha acreditado una generación eliminada mediante esas etiquetas. Mantener labels apagado hasta demostrar una sustitución efectiva y coste total no superior, incluida su reutilización posterior. No atribuirle ahorro por desplazar el coste a background.

Las pruebas reales detectaron tres defectos: start_mode contaminaba la copia de bloques por duración, los días laborables podían codificarse como ISO en vez de Calendar nativo, y execute sin acción rechazaba observaciones válidas. La normalización conserva la duración, convierte el rango literal lunes a viernes a [2,3,4,5,6] y permite gestión de observaciones sin autoridad de dispositivo. Las transformaciones de texto autocontenidas cierran las herramientas de efectos; su contenido no se convierte en orden. Se conservan los primeros fallos como evidencia.

Las tres sustituciones se validan independientemente. bm-agent-activation.json las mantiene desactivadas en producción hasta disponer de evidencia del runtime exacto. La vía vigente sigue siendo el fallback.

| Configuración | Efecto |
|---|---|
| BM_AGENT_QA_ENABLED=true y SUPABASE_URL=https://njqbovsmoowkhhsqmitn.supabase.co | Permite pruebas explícitas en la base aislada conocida |
| BM_AGENT_QA_FEATURES=tools o retrieval o labels | Aísla la sustitución; admite una lista separada por comas |
| BM_AGENT_ENABLED=true | Solo activa features con manifiesto aprobado, modelo y hashes coincidentes |
| BM_AGENT_LABEL_DAILY_USD | Tope diario explícito mayor que 0 y menor o igual a 5; sin valor no hay clasificación |

La migración 036_bm_agent_labels.sql es aditiva y no depende de 029/030. Aplicar036 aisladamente tras028/034 y descanso035 en integración; nunca ejecutar db push de todo el historial por este cambio. PR41 utiliza también la versión 035, con 035_bmb_measured_rest.sql: la release debe inspeccionar el historial, resolver la numeración y actualizar referencias/fingerprint antes de aplicar ambas. RLS y RPC son exclusivos de service_role. Reserva conservadora de 0,01 USD antes del proveedor; consumo conocido ajusta la reserva y un intento cobrado sin uso conocido conserva el máximo. Sin reintentos automáticos. Estos límites no amplían el presupuesto de evaluación previamente autorizado.

## Validación reproducible

Evidencia local de esta implementación en tmp/agent-eval: tools-200.json conserva 200 pares/400 turnos del primer candidato y sus fallos; focused-final.json verifica las correcciones en 12 pares/24 turnos; retrieval-pilot.json prueba la preparación ampliada con 16 pares/32 turnos. Las cifras del primer candidato no acreditan el runtime corregido. voice-provider.json registra 8 síntesis ES/EN reales desde respuestas guardadas; no son una comparación pareada hasta primer audio desde la entrada ni una prueba de reproducción en iPhone.

Las revisiones del juez son de modelo, no humanas. Las versiones de contexto se conservan: V1 carecía de parte del estado del dispositivo; V2 distingue la fuente actual de las observaciones de cuenta; V3 aclara qué filas estaban sembradas antes y qué cambió realmente el commit. Nunca sustituir los primeros dictámenes por otros sin registrar esa versión. La muestra corregida tiene 12/12 respuestas candidatas aceptadas en V2; sus 12 pares no cumplen el mínimo de 200 ni la cobertura de voz del gate.

Guillem repuso el saldo API; se superó el antiguo 429 sin ampliar el techo de 34 USD. Las revisiones V3 pendientes finalizaron: piloto de consultas 16/16 candidatos aceptados y regresión previa 12/12. Se repitió el etiquetador con cuatro llamadas reales: persistencia, deduplicación, corrección, olvido y lote de 26 preguntas correctos; bedtime siguió como other con el umbral conservador. Esto no acredita calidad temática completa ni una generación retirada.

tools-final-200.json conserva otra ejecución de los mismos 200 casos pareados en 3283b8d: 200/200 respuestas candidatas y 50/50 acciones con parámetros correctos. La auditoría detectó preferencias/objetivos no guardados: una reparación podía devolver respuesta compacta y perder los efectos. La revisión independiente se detuvo en 224/400 ante ese fallo confirmado; los cuatro intentos en vuelo mantienen 0,184865 USD de reserva desconocida. Sus métricas no acreditan la versión corregida.

cc56090 corrigió la pérdida y obtuvo 20/20 hechos persistidos en una generación. La muestra final final-regression-v2.json, runtime f21399b, contiene 60 pares/120 turnos: 60/60 respuestas candidatas, 20/20 hechos guardados y los 15 comandos nativos en ES/EN, incluidas ambas pausas de dos horas. El juez independiente revisó los 120 turnos: acepta 58/60 candidatos y 52/60 controles. Conserva dos dictámenes negativos del candidato, sobre una promesa de aviso futuro y el alcance de un borrado de hábitos; necesitan revisión/corrección. Los fallos anteriores y el timeout de la muestra intermedia se preservan.

El aislamiento posterior del modo proactivo se comprueba localmente y con final-guard.json en b8219fc: cuatro pares/ocho turnos, cuatro respuestas candidatas aceptadas por el juez y una generación por candidato. La muestra de 60 pares precede ese guard y no se presenta como evaluación íntegra del hash posterior. No hay certificado de los tres objetivos: faltan 200 pares del runtime final por sustitución, cobertura por grupo/idioma y primer audio pareado, además de integración y prueba física. Las tres features siguen apagadas.

El corpus nuevo exige comprobar el commit aplicado y la lectura posterior de cada preferencia/objetivo esperado; una confirmación textual o un dictamen positivo del juez no sustituyen la escritura. El evaluador admite --candidate-first y --stop-file para parar entre lotes conservando las peticiones y reservas. Los informes originales no se sobrescriben.

1. node tools/bm_agent_runtime.js verifica el fingerprint de todos los módulos de Functions, usado como constante de compilación para esbuild/nft. Después de cambiar runtime, regenerarlo con --write y repetir evaluación; el manifiesto anterior deja de coincidir.
2. node tools/bm_agent_test.js y node tools/bm_response_stream_test.js cubren las herramientas, acciones, memoria/olvido, paginación, lecturas agrupadas, separación de cuentas y SSE fragmentado. node tools/bm_agent_evidence_test.js comprueba rechazos de evidencia defectuosa; sus fixtures inventados nunca se instalan como aprobación.
3. El workflow BM Harness Gate aplica 035 en PostgreSQL 15 desechable y ejecuta tools/bm_agent_database_test.sql, junto a las regresiones de transacciones, voz y memoria. Los scripts SQL de pruebas nunca se ejecutan en Supabase.
4. node tools/bm_agent_acceptance.js measured-pairs.json report.json exige al menos 200 casos pareados por feature, ES/EN, conversación/consulta/acción/memoria, voz real, recibos de proveedor, revisión independiente, coste completo de background/reintentos y hashes actuales. Compara p50/p95 de primer texto/audio y calidad tanto agregada como por idioma/grupo. Es un evaluador de recibos: no llama a proveedores ni activa flags.
5. Integrar y desplegar únicamente desde la conversación/rama de release según BACKEND_INTEGRATION_WORKFLOW.md. Confirmar bundles/hashes, aplicar solo035/036 pendientes tras comprobar historial, probar cuentas aisladas y acciones en iPhone. Un PASS local o SQL no acredita eficacia física ni ahorro.

El comando de harness de cierre usa --baseline tmp/product-harness/baseline.json --enforce-scope. La evaluación semántica exige un árbol limpio: un source_dirty mantiene su fallo original y se repite tras commit, sin debilitar el gate. No se ha alterado el generador principal gpt-5.6-luna ni las voces de ElevenLabs.

## Entrega a integración

- Rama: codex/conversational-agentic-2026-10-14, PR42. Runtime final: b8219fc; los commits posteriores de cierre/documentación deben conservar sus Functions y SQL. Recibo de esta reanudación: tmp/agent-eval/credit-resume-receipt.json.
- Superficies: BMB reactivo, dos herramientas, contratos de parámetros, stream y callback de clasificación; tests, evaluador y SQL de etiquetas. La app nativa y el contrato proactivo conservan su comportamiento previo.
- Migración: 036_bm_agent_labels.sql, posterior a 028/034, con colisión de número frente a PR41. Resolver en la release, actualizar referencias/fingerprint y validar de nuevo la fuente integrada; aplicar solo la migración aditiva tras comprobar el historial remoto.
- Variables: BM_AGENT_QA_ENABLED y BM_AGENT_QA_FEATURES en la QA conocida; BM_AGENT_LABEL_DAILY_USD para su reserva. BM_AGENT_ENABLED no activa un manifiesto sin aprobación real. No ampliar cuotas de proveedor ni el techo FINAL de evaluación de 40 USD.
- Pendiente: adjudicar/corregir los dos dictámenes negativos, completar comparación del runtime integrado con voz pareada y los grupos/idiomas requeridos, y verificar acciones/permisos/selección en iPhone. Los paquetes locales y las muestras de software no sustituyen esas comprobaciones ni autorizan producción.

