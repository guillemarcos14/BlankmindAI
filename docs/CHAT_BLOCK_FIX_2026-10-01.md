# Chat block correction — 2026-10-01

Objetivo: ejecutar el CTA del chat sobre la selección canónica sin duplicar la notificación.
Rama: codex/ios-web-identity-current-2026-09-27
Commits: d82704e, 066143b

La fecha requested_at del servidor usa milisegundos ISO 8601. El lector nativo solo aceptaba segundos enteros: startProtection terminaba en missing_exact_action_metadata. Ahora conserva ambas representaciones. La aplicación consulta el inbox autenticado y comprueba ID, caducidad e identidad antes de cerrar el chat; prepara la acción exacta y la ejecuta en onDismiss. Errores de consulta permanecen en el chat. El poll periódico no compite mientras el chat está abierto.

Backend: whatsapp-agent.js omite APNs y el retry para connection.channel=app; mantiene el enqueue durable y los transportes WhatsApp/SMS. Integrar este archivo en la rama backend de release antes de desplegar. Ninguna migración ni variable nueva.

Validaciones: assistant_app_test (incluye cero push inicial y en replay), production_app_activation_test y contratos fuente de protección correctos. CI macOS ejecuta el lector de fechas de producción con milisegundos, segundos, texto inválido y fecha ausente, además de build de simulador. Pruebas nativas macOS y build de simulador correctas en CI 36896165952. Harness final 62/63 con baseline, diff-base 88e1756 y scope sin infracciones; único fallo release_gate_quick por evidencia semántica/física previa insuficiente.

Pendiente operativo: nueva build firmada/distribuida y publicación backend por integración; comprobar bloqueo real y ausencia de push duplicado en iPhone. El TestFlight instalado no incorpora este cambio por actualizar código en GitHub.
