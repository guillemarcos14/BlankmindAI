# Decisions: activación global por excepción explícita

Guillem ordenó «Ponlo ON, implementa autónomo» y pidió continuar en una conversación nueva. La instrucción posterior autoriza activar producción globalmente con las carencias ya explicadas, sin aumentar el techo acumulado de 24 USD. Procedencia: conversación 01a12128-48bf-7511-9846-f64c29d09e45, delegación a esta conversación.

Paquete exacto b9935d976bce6821ce23044505cfaac46041e352, runtime netlify/functions idéntico a 5c3134c8f880b86dd37dd7d6133029dbb405703e. QA privada ya verificó diez hashes y autenticación/aislamiento. Las 200 respuestas/108 valoraciones corresponden a 5c, no se reclasifican como una evaluación de b993. Quedan 92 valoraciones, revisión humana (0) y 20 pruebas físicas (0), además de build exacta; no existe certificación completa ni garantía de publicación Apple.

La excepción está limitada a sitio 59955668-9a9b-4979-a283-63fbf3115fe5, Supabase vhiikgyyfisejjwqtxfc, SQL 026–028 y el paquete congelado. `tools/bm_decisions_authorized_release.js` valida autorización, hashes, ledger y conservación del inventario; prepara un draft antes de publicarlo. El gate general `backend_release.js`/`bm_release_readiness_gate.js` no se modifica. Jev OFF, política authenticated-account-records, sin cohortes. No se aplican SQL 029–033 ni se activa voz nueva (BM_VOICE_ENABLED conserva su valor ausente/OFF); se conserva la voz anterior y sus secretos. El endpoint nuevo de voz está en el paquete pero permanece desactivado.

Antes: deploy 6abe94a92bf201769389c075, 73 funciones y 17 archivos públicos. Conservar sus hashes y configuración, salvo las entradas sustituidas por el paquete compatible. APNs/voz/transportes y claves vivas no se sobrescriben. Las migraciones son aditivas y transaccionales; no se repara el historial 020 ni se ejecuta db push global.

Recibos operativos nuevos: `tmp/decisions-production/production-live-preflight-authorized.json`, `production-authorization-b993.json`, `production-migrations-authorized.json`, `production-release-authorized.json`. Los snapshots/evaluaciones/handoff anteriores se conservan byte a byte. No se ejecutan nuevas llamadas pagadas de prueba ni se liberan reservas opacas.

Rollback: configurar BM_RETRIEVAL_STEP_ENABLED=false en functions/production, crear un nuevo deploy desde el mismo paquete compatible y el inventario conservado, verificar hashes, autenticación/aislamiento y publicar. Mantener tablas y datos; sin down SQL. Una restauración de flags sin republish no basta.

Resultado final se registra al verificar el deploy publicado; preparar este documento no acredita activación.
