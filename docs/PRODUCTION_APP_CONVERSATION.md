# Conversación in-app de BM Final

## Contrato

- `assistant-app` exige un JWT vigente de Supabase y un `app_install_id` que coincida con la identidad autenticada. El cliente iOS usa Sign in with Apple con nonce; guarda access/refresh tokens en Keychain y renueva la sesión mediante `app-auth`. Si ya existe una sesión telefónica autenticada, se vincula Apple a la misma identidad Supabase para conservar el ID y el historial.
- `history` pagina los turnos propios de 60 en 60 con cursor opaco de fecha e ID; los empates de fecha no pierden mensajes. `send` usa un UUID y texto inmutables; `status` recupera ese turno sin volver a planificarlo. La pantalla principal muestra la última salida y el historial conserva las entradas.
- El turno llama a `callBlankedAgent` de BM Final. El perfil canónico sigue asociado al connect code; la memoria y el canal de la app se identifican con el ID autenticado de Supabase, no con un teléfono. No crea un agente ni un prompt alternativo. La app no envía una copia del turno por WhatsApp.
- Una acción válida se encola en la misma bandeja nativa con ID `app_...`; `Apply now` usa el polling y el acuse existentes del iPhone. La interfaz solo muestra `verified` tras el recibo físico. Los avisos de reintento y resultado de esta acción se consultan en la app, sin mensaje saliente de WhatsApp.

## Recuperación y concurrencia

- La migración `023` reserva cada turno con lease de 90 segundos y serializa los turnos activos de una cuenta. La respuesta preparada y la memoria semántica compartida se guardan en una sola transacción CAS. La app exige esa memoria canónica por llamada, incluso si faltan los marcadores de entorno de Netlify.
- Ante una desconexión, el cliente conserva UUID, texto y cuenta. Reenvía el mismo turno: `202` indica que sigue procesándose; `503` permite reintentar; un turno fallido se recupera inmediatamente y uno interrumpido tras expirar su lease. `409 turn_payload_conflict` rechaza cambiar el texto asociado al UUID; `409 conversation_in_progress` permite esperar y reintentar. `status` devuelve `404` cuando aún no existe.
- La acción preparada conserva ID, hora solicitada y expiración originales. Su evento de cola y su marca durable se guardan bajo el mismo bloqueo de la memoria semántica: una actualización posterior por WhatsApp impide que un reintento antiguo sobrescriba o borre su acción. Un reintento no renueva un bloqueo caducado.
- Los acuses nativos terminales se conservan en el turno antes de avanzar la memoria del canal. La finalización de la respuesta no puede borrar un acuse concurrente. Un fallo al leer memoria deja la respuesta disponible y la acción temporalmente no aplicable; no se infiere ejecución.
- `app-auth` admite únicamente Apple ID-token sign-in y renovación de sesión; rechaza acciones OTP. `waitlist-auth` conserva el OTP SMS de la web Early Access. Los endpoints de canal `app` también exigen JWT, instalación y cuenta coincidentes. Las funciones no devuelven mensajes internos de Supabase ni detalles de tokens.

## Release protegido

1. Integrar el commit de esta rama desde `docs/BACKEND_INTEGRATION_WORKFLOW.md` en `codex/backend-release-*`, con baseline del product harness.
2. Comprobar esquema e historial de Supabase. Aplicar `022_assistant_app_turns.sql` y `023_assistant_app_recovery.sql` antes de exponer `assistant-app`; no reparar historial remoto automáticamente. La `023` usa las tablas existentes de `003` y `015`.
3. Configurar Apple en Supabase y Apple Developer; habilitar manual identity linking para cuentas telefónicas existentes. Confirmar que `waitlist-auth` conserva la verificación OTP web y que `app-auth` no la expone al cliente iOS.
4. Validar transporte/auth, smokes BM Final y product harness `--enforce-scope`. En una base PostgreSQL desechable, ejecutar `tools/assistant_app_database_setup.sql`, migraciones `003`, `015`, `022`, `023` y `tools/assistant_app_database_test.sql`; nunca ejecutar el setup de pruebas en Supabase real. Publicar Netlify y Supabase solo desde integración con `backend_release.js --confirm` y sus gates vigentes.
5. Compilar y distribuir la app iOS firmada. Probar en iPhone Apple sign-in nuevo, vinculación de cuenta heredada e historial conservado, renovación de sesión, voz, historial, propuesta, `Apply now`, selección canónica, APNs y acuse `verified`/`failed`.

La build de simulador comprueba compilación, no firma ni ejecución de Screen Time en iPhone. Un acuse APNs aceptado tampoco demuestra bloqueo aplicado.
