# Conversación in-app de BM Final

## Contrato

- `assistant-app` exige un JWT vigente de Supabase y un `app_install_id` que coincida con la identidad autenticada. El cliente iOS guarda access/refresh tokens en Keychain tras OTP y renueva la sesión mediante `app-auth`.
- `history` pagina los turnos propios de 60 en 60 con cursor opaco de fecha e ID; los empates de fecha no pierden mensajes. `send` usa un UUID y texto inmutables; `status` recupera ese turno sin volver a planificarlo. La pantalla principal muestra la última salida y el historial conserva las entradas.
- El turno llama a `callBlankedAgent` de BM Final con la misma memoria semántica, perfil canónico y selección de distracciones que WhatsApp. No crea un agente ni un prompt alternativo. La app no envía una copia del turno por WhatsApp.
- Una acción válida se encola en la misma bandeja nativa con ID `app_...`; `Apply now` usa el polling y el acuse existentes del iPhone. La interfaz solo muestra `verified` tras el recibo físico. Los avisos de reintento y resultado de esta acción se consultan en la app, sin mensaje saliente de WhatsApp.

## Recuperación y concurrencia

- La migración `023` reserva cada turno con lease de 90 segundos y serializa los turnos activos de una cuenta. La respuesta preparada y la memoria semántica compartida se guardan en una sola transacción CAS. La app exige esa memoria canónica por llamada, incluso si faltan los marcadores de entorno de Netlify.
- Ante una desconexión, el cliente conserva UUID, texto y cuenta. Reenvía el mismo turno: `202` indica que sigue procesándose; `503` permite reintentar; un turno fallido se recupera inmediatamente y uno interrumpido tras expirar su lease. `409 turn_payload_conflict` rechaza cambiar el texto asociado al UUID; `409 conversation_in_progress` permite esperar y reintentar. `status` devuelve `404` cuando aún no existe.
- La acción preparada conserva ID, hora solicitada y expiración originales. Su evento de cola y su marca durable se guardan bajo el mismo bloqueo de la memoria semántica: una actualización posterior por WhatsApp impide que un reintento antiguo sobrescriba o borre su acción. Un reintento no renueva un bloqueo caducado.
- Los acuses nativos terminales se conservan en el turno antes de avanzar la memoria del canal. La finalización de la respuesta no puede borrar un acuse concurrente. Un fallo al leer memoria deja la respuesta disponible y la acción temporalmente no aplicable; no se infiere ejecución.
- `app-auth` distingue sesión caducada (`401`) de caída temporal (`502`) y límite de frecuencia (`429`). Los endpoints no devuelven mensajes internos de Supabase ni detalles de tokens.

## Release protegido

1. Integrar el commit de esta rama desde `docs/BACKEND_INTEGRATION_WORKFLOW.md` en `codex/backend-release-*`, con baseline del product harness.
2. Comprobar esquema e historial de Supabase. Aplicar `022_assistant_app_turns.sql` y `023_assistant_app_recovery.sql` antes de exponer `assistant-app`; no reparar historial remoto automáticamente. La `023` usa las tablas existentes de `003` y `015`.
3. Validar `node tools/assistant_app_test.js`, `node tools/app_auth_test.js`, `node tools/bm_app_receipt_test.js`, smokes BM Final y product harness `--enforce-scope`. En una base PostgreSQL desechable, ejecutar `tools/assistant_app_database_setup.sql`, migraciones `003`, `015`, `022`, `023` y `tools/assistant_app_database_test.sql`; nunca ejecutar el setup de pruebas en Supabase real. Publicar Netlify y Supabase solo desde integración con `backend_release.js --confirm` y sus gates vigentes.
4. Compilar y distribuir la app iOS firmada. Probar en iPhone OTP, sesión renovada, continuidad WhatsApp/app, voz, historial, propuesta, `Apply now`, selección canónica, APNs y acuse `verified`/`failed`.

La build de simulador comprueba compilación, no firma ni ejecución de Screen Time en iPhone. Un acuse APNs aceptado tampoco demuestra bloqueo aplicado.
