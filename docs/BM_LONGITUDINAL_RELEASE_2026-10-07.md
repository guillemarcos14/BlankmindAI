# Seguimiento BM: integracion QA y build106

Guillem autorizo integrar y publicar autonomamente en esta tarea y pidio incluir todos los commits pendientes al compilar. La release `codex/backend-release-bm-longitudinal-2026-10-07` parte del QA desplegado fb9879f, integra c0af218 mediante ccb0ba9 y corrige operaciones de memoria sin accion nativa en27ebbd02b48d67c2cc3a5fd4c5e167061d34d266. La misma correccion esta en la rama PR20 como feb0a5d.

## Backend privado activo

- Supabase QA njqbovsmoowkhhsqmitn:028 aplicada transaccionalmente sobre027 y registrada con su SQL exacto. El push general detecto025 historica ausente; no se aplico ni se falseo esa migracion ajena. No se ejecutaron fixtures de tests SQL sobre cuentas reales.
- Netlify QA2ef5a74e-af70-4893-a5f6-63fb2537720d: deploy6ac61d0da76193140af4ef1d, nueve funciones y hashes verificados. Streaming conserva invocation_mode/metadata. Privacidad, cookie interna y permisos actuales conservados; ninguna credencial en Git o informes.
- Harness previo al despliegue:71/71, baseline antes de integrar fb9879f, scope correcto; ph_1791368352834_40de18df. La publicacion incluye modelo, cron y worker existentes, sin otro sistema de agentes ni nuevos permisos.
- Un olvido real produjo503/bmb_missing_action: el modelo eligio execute/actionnull con una operacion de memoria valida. Ahora se normaliza a respond solo si existe memoria validada; una ejecucion nativa sin accion sigue rechazada. Tests comprueban evidencia inventada, operaciones desconocidas y ausencia de memoria.

## Comprobaciones remotas

En el deploy final, seguimiento7/7 y streaming8/8. Cuentas sinteticas example.invalid; limpieza completa verificada. Timeline con32 noches declaradas,28base y4recientes: cambio60min, alternativas y pregunta persistentes con permisos de notificacion apagados. Replay sin duplicados, acceso directo rechazado, pregunta filtrada por propietario, respuesta atomica con nuevo contexto y olvido que redacta observaciones/informe/respuestas. El worker se invoco con HMAC de su clave viva; HTTP202 por si solo no se conto como ejecucion.

La prueba de consulta contextual usa un recibo de transporte simulado: no acredita APNs ni toque fisico. Cero notificaciones enviadas y cero acciones nativas ejecutadas. Streaming:126 borradores, primero7046ms y final12761ms en un turno sintetico; cifras de una muestra, no SLA.

Intentos anteriores preservados: una firma con una clave antigua no ejecuto el worker, una prueba encontro el fallo de olvido corregido y una evaluacion diaria termino failed antes de la pasada final. La ultima se repitio sin relajar validaciones; el producto mantiene tres intentos diarios/espera30min. Estos resultados no acreditan fiabilidad longitudinal o utilidad clinica en usuarios reales.

Informes locales ignorados: `tmp/longitudinal-release/cloud-smoke.json`, `stream-cloud.json`, intentos anteriores y `native-integration.json`; package27eb en Codigo-writing-feedback/tmp/cloud-stage. Conservan IDs/digests y resultados, sin credenciales.

## Build1.9(106)

FF368, checkout limpio `/Users/user301201/blankmind-bmb-qa` actualizado a27ebbd0. Archive `/Users/user301201/blank-testflight-105/blankmind106-27ebbd0.xcarchive`: ARCHIVE SUCCEEDED; codesign --verify --deep --strict sin errores; Info.plist1.9/106 y BlankMembershipAPIBaseURL apunta al QA privado.

qa106.xcconfig derivada deqa105 cambiando solo CURRENT_PROJECT_VERSION; cmp normalizado sin esa linea identico. Config chmod600, temporales/log nuevos con umask077. Comandos de Terminal escritos con una pulsacion por caracter. No se ha operado Xcode ni subido106 a TestFlight.

Auditoria de todas las ramas locales/remotas desde6oct: ningun commit nativo reciente queda fuera de la release. Incluye lectura/scroll de respuestas Home, haptico continuo0.55, retirada de CTA duplicada/carreras y contexto del seguimiento por notificacion. El arbol iOS es identico en ccb0ba9 y27ebbd0.

CI37603825452 en ccb0ba9 completa correctamente pruebas nativas, compilacion Simulator, siete XCTest Home y capturas uniformes/compactas/texto grande. Otro intento37602516549 fallo solo por timeout de capturas; no se modificaron los checks. Backend/PostgreSQL15/Android37602516707 correctos para el desarrollo previo. Evidencia Mac `tmp/longitudinal-release/native106-verified.jpg`; capturas CI en `ios-visual/`.

Pendientes: distribucion106, notificacion y respuesta en iPhone, ritmo diario/ingestion consentida y efecto real de planes. Produccion conserva su gate separado de modelo/judge/build firmada y20 casos fisicos; esta publicacion QA no acredita esas condiciones.
