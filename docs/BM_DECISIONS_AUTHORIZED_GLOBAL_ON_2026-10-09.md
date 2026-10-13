# Decisions: activación global por excepción explícita

Guillem ordenó «Ponlo ON, implementa autónomo» y pidió continuar en una conversación nueva. La instrucción posterior autoriza activar producción globalmente con las carencias ya explicadas, sin aumentar el techo acumulado de 24 USD. Procedencia: conversación 01a12128-48bf-7511-9846-f64c29d09e45, delegación a esta conversación.

Paquete exacto b9935d976bce6821ce23044505cfaac46041e352, runtime netlify/functions idéntico a 5c3134c8f880b86dd37dd7d6133029dbb405703e. QA privada ya verificó diez hashes y autenticación/aislamiento. Las 200 respuestas/108 valoraciones corresponden a 5c, no se reclasifican como una evaluación de b993. Quedan 92 valoraciones, revisión humana (0) y 20 pruebas físicas (0), además de build exacta; no existe certificación completa ni garantía de publicación Apple.

La excepción está limitada a sitio 59955668-9a9b-4979-a283-63fbf3115fe5, Supabase vhiikgyyfisejjwqtxfc, SQL 026–028 y el paquete congelado. `tools/bm_decisions_authorized_release.js` valida autorización, hashes, ledger y conservación del inventario; prepara un draft antes de publicarlo. El gate general `backend_release.js`/`bm_release_readiness_gate.js` no se modifica. Jev OFF, política authenticated-account-records, sin cohortes. No se aplican SQL 029–033 ni se activa voz nueva (BM_VOICE_ENABLED conserva su valor ausente/OFF); se conserva la voz anterior y sus secretos. El endpoint nuevo de voz está en el paquete pero permanece desactivado.

Antes: deploy 6abe94a92bf201769389c075, 73 funciones y 17 archivos públicos. Conservar sus hashes y configuración, salvo las entradas sustituidas por el paquete compatible. APNs/voz/transportes y claves vivas no se sobrescriben. Las migraciones son aditivas y transaccionales; no se repara el historial 020 ni se ejecuta db push global.

Recibos operativos nuevos: `tmp/decisions-production/production-live-preflight-authorized.json`, `production-authorization-b993.json`, `production-migrations-authorized.json`, `production-release-authorized.json`. Los snapshots/evaluaciones/handoff anteriores se conservan byte a byte. No se ejecutan nuevas llamadas pagadas de prueba ni se liberan reservas opacas.

Rollback: configurar BM_RETRIEVAL_STEP_ENABLED=false en functions/production, crear un nuevo deploy desde el mismo paquete compatible y el inventario conservado, verificar hashes, autenticación/aislamiento y publicar. Mantener tablas y datos; sin down SQL. Una restauración de flags sin republish no basta.

## Resultado real: activación bloqueada

SQL 026–028 aplicado en una transacción: ocho tablas con RLS, sin SELECT de authenticated y con acceso service_role; funciones SECURITY DEFINER restringidas al servidor. Historial 020 intacto, 024/029–033 no aplicado. Antes de pruebas había 9 usuarios auth, 8 turnos y 0 cuentas BMB; no se han eliminado ni modificado datos existentes.

El primer preflight rechazó metadata histórica `is_secret=false`: las claves vivas se verificaron por identidad JWT de producción y formato del proveedor sin escribirlas, copiarlas a informes ni cambiar scopes. No produjo mutaciones. El segundo intento creó draft 6ac93e96875ca3d8c36b84d6, pero Netlify exigió los ZIP de funciones anteriores. Se recuperaron 29 hashes del inventario de 73; quedan 43 funciones que deben conservarse y cuyos artefactos exactos no aparecen en 11.502 ZIP locales inspeccionados. El índice histórico apunta a `C:/Users/Guillem/AppData/Local/Temp/dqdv4U`, que ya no existe. No se sustituyen esas funciones por código distinto para cerrar el despliegue.

Draft cancelado (estado error). Flag global vuelto a false. Publicado sigue 6abe94a92bf201769389c075: 73 hashes y 17 archivos iguales al preflight. Decisions/Jev OFF. Recibo `production-safe-stop-authorized.json`. No nuevas llamadas pagadas: conocido23,40453732/reserva23,93839122/techo24 USD. La autorización ON se mantiene, pero no se informa como ejecutada.

Herramienta endurecida: ahora exige todos los artefactos anteriores con SHA correcto antes de tocar flags, y reutiliza cada nombre/metadata incluso cuando comparten digest. Normal gate intacto. Harness de fuente limpia 7970bbf:88/88/scope; primer intento con fuente dirty:87/88, replay48/48 pero release_eligible=false por dirty, conservado. Tests de identidad/artefactos añadidos tras el bloqueo; validación final en el recibo de cierre.

Reanudar: recuperar los 43 ZIP exactos (lista de nombres/SHA en `production-safe-stop-authorized.json`), completar el índice con paths existentes, crear NUEVO snapshot de autorización conservando los anteriores y hacer draft/auth-BMB smoke/publish/hashes/flags. No repetir SQL, no reconstruir corpus ni añadir presupuesto. Rollback de este intento ya completado sin down.
