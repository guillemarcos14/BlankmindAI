# Sistema conversacional y agéntico

Implementación del esquema aprobado el 14 de octubre de 2026, conservado literalmente en Blank Brain/REFERENCIAS/modelo_conversacional_agentico_fuente_de_verdad.md. Esta guía describe el código y su activación; no redefine el esquema ni el modelo central de descanso.

## Flujo implementado

El agente genera una respuesta compacta o una llamada nativa a una de dos herramientas. consultar_contexto agrupa hasta tres consultas independientes, limita fuentes y páginas y reutiliza lecturas idénticas dentro del turno. gestionar prepara cambios de dispositivo, propuestas, memoria y seguimiento. El servidor conserva la identidad autenticada y valida evidencia literal, parámetros, consentimiento, propuestas, permisos y recibos; el modelo no escribe directamente ni acredita un bloqueo físico.

Las respuestas y la gestión completas requieren una generación cuando no hace falta consultar ni corregir el resultado. Una consulta requiere evidencia nueva y otra generación. No se añade una generación para repetir los argumentos de gestionar: su texto describe el intento y solo se entrega como respuesta definitiva después de la transacción existente de preparación, cola y commit. El iPhone comunica el resultado real por el canal existente. El texto provisional del streaming no ejecuta acciones.

El contexto automático reciente se reduce a ocho turnos al activar tools; el resto sigue accesible desde offset 8. Las memorias, los límites de olvido y la recuperación de propuestas conservan sus controles.

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

La migración 035_bm_agent_labels.sql es aditiva y no depende de 029/030. Aplicarla aisladamente en integración, después de 028 y 034; nunca ejecutar db push de todo el historial por este cambio. RLS y RPC son exclusivos de service_role. Reserva conservadora de 0,01 USD antes del proveedor; consumo conocido ajusta la reserva y un intento cobrado sin uso conocido conserva el máximo. Sin reintentos automáticos. Estos límites no amplían el presupuesto de evaluación previamente autorizado.

## Validación reproducible

Evidencia local de esta implementación en tmp/agent-eval: tools-200.json conserva 200 pares/400 turnos del primer candidato y sus fallos; focused-final.json verifica las correcciones en 12 pares/24 turnos; retrieval-pilot.json prueba la preparación ampliada con 16 pares/32 turnos. Las cifras del primer candidato no acreditan el runtime corregido. voice-provider.json registra 8 síntesis ES/EN reales desde respuestas guardadas; no son una comparación pareada hasta primer audio desde la entrada ni una prueba de reproducción en iPhone.

Las revisiones del juez son de modelo, no humanas. Las versiones de contexto se conservan: V1 carecía de parte del estado del dispositivo; V2 distingue la fuente actual de las observaciones de cuenta; V3 aclara qué filas estaban sembradas antes y qué cambió realmente el commit. Nunca sustituir los primeros dictámenes por otros sin registrar esa versión. La muestra corregida tiene 12/12 respuestas candidatas aceptadas en V2; sus 12 pares no cumplen el mínimo de 200 ni la cobertura de voz del gate.

El último intento del etiquetador recibió 429 credit_balance_exhausted, request req_65a6bc75b57943e3b6b95b2703e91984. Quedan pendientes la repetición de la rúbrica temática refinada y los dictámenes V3; el presupuesto autorizado conserva margen. El fallo no se convierte en aprobación ni dispara reintentos automáticos. Las tres features siguen apagadas en producción.

1. node tools/bm_agent_runtime.js verifica el fingerprint de todos los módulos de Functions, usado como constante de compilación para esbuild/nft. Después de cambiar runtime, regenerarlo con --write y repetir evaluación; el manifiesto anterior deja de coincidir.
2. node tools/bm_agent_test.js y node tools/bm_response_stream_test.js cubren las herramientas, acciones, memoria/olvido, paginación, lecturas agrupadas, separación de cuentas y SSE fragmentado. node tools/bm_agent_evidence_test.js comprueba rechazos de evidencia defectuosa; sus fixtures inventados nunca se instalan como aprobación.
3. El workflow BM Harness Gate aplica 035 en PostgreSQL 15 desechable y ejecuta tools/bm_agent_database_test.sql, junto a las regresiones de transacciones, voz y memoria. Los scripts SQL de pruebas nunca se ejecutan en Supabase.
4. node tools/bm_agent_acceptance.js measured-pairs.json report.json exige al menos 200 casos pareados por feature, ES/EN, conversación/consulta/acción/memoria, voz real, recibos de proveedor, revisión independiente, coste completo de background/reintentos y hashes actuales. Compara p50/p95 de primer texto/audio y calidad tanto agregada como por idioma/grupo. Es un evaluador de recibos: no llama a proveedores ni activa flags.
5. Integrar y desplegar únicamente desde la conversación/rama de release según BACKEND_INTEGRATION_WORKFLOW.md. Confirmar bundles/hashes, aplicar solo 035, probar cuentas aisladas y acciones en iPhone. Un PASS local o SQL no acredita eficacia física ni ahorro.

El comando de harness de cierre usa --baseline tmp/product-harness/baseline.json --enforce-scope. La evaluación semántica exige un árbol limpio: un source_dirty mantiene su fallo original y se repite tras commit, sin debilitar el gate. No se ha alterado el generador principal gpt-5.6-luna ni las voces de ElevenLabs.
