# Círculo y chat — 2026-10-04

Candidato `764d139`, PR #14, rama `codex/home-orb-2026-10-03`.

- Arrastre radial de 48 pt en cualquier dirección abre secciones; seguimiento directo del dedo, fade al alcanzar el umbral, consumo de una sola acción. Hold de 2 s sigue abriendo chat. Círculo oculto en menú; tocar el fondo cierra y lo restaura. Movimiento reducido y acciones accesibles conservados. El bloqueo manual sigue disponible en menú/widget, sin activación por arrastre.
- Desbloqueo conserva hold de 20 s y cooldown; pulsos a intervalos constantes de 1 s.
- Chat muestra un saludo nuevo al abrir; no expone la última respuesta histórica. Respuestas y acciones visibles vinculadas al turno de esta visita; historial accesible mediante botón textual. Se retiran ellipsis y subtítulo Blankmind. Estado/reintento no quedan cortados por el límite previo de 120 pt. Recuperación conserva UUID/texto y no ejecuta acciones antiguas.
- Saludo generado en endpoint autenticado `greeting`, sin planner conversacional, turnos, memoria ni acciones. Usa OPENAI_MODEL existente y timeout 6 s; fallback local aleatorio si falla. No modifica instrucciones/configuración de BMB. Pruebas comprueban el mismo consejo textual con protección activa/inactiva y cero acciones para la pregunta de sueño.
- Causa del fallo de bloqueo 5 min: monitor de temporizador inferior al mínimo Apple de 15 min. Ahora se programa un monitor de 15 min que comienza en la caducidad solicitada y libera al inicio; sin extender el bloqueo. Prefijo nuevo impide reinterpretar el inicio de monitores antiguos. Callback tardío no libera protección nueva o indefinida.

Validación: CI iOS37195097686/37195100510 completas (764d139), pruebas Swift y build Simulator correctos; CI BM/PostgreSQL/Android37195100509 correcta. Se revisaron capturas activas de saludo/respuesta/error, error con Dynamic Type y menú sin círculo: contraste, campo/micro y Reintentar visibles. Fixtures sintéticas sin Screen Time real. Evidencia `tmp/orb-chat-visuals-764d139/`. Harness final69/69, baseline `tmp/product-harness/baseline-chat-orb-20261004.json`, diffd23807f, scope sin infracciones; informe `tmp/product-harness/chat-orb-final.json` (ph_1791109884723_27be6cad). Pasadas anteriores68/69 por gate público previo; el cierre técnico no acredita proveedor real, firma, publicación ni0/20casos físicos pendientes.

Pendiente operativo: incorporar endpoint a backend QA y distribuir nueva build; comprobar gesto/vibración/Screen Time en iPhone. TestFlight 93 sigue anterior. Sin despliegue ni distribución en esta tarea.

## Entrega Backend Cloud

Objetivo: saludo generativo de apertura sin alterar conversación ni acciones.
Rama: codex/home-orb-2026-10-03.
Commit runtime: 764d139.
Superficies: netlify/functions/assistant-app.js y bmb-greeting.js; pruebas assistant_app_test.js/bmb_greeting_test.js y contrato harness.
Migraciones: ninguna. Variables nuevas: ninguna; reutiliza OPENAI_MODEL/OPENAI_API_KEY.
Validación: saludo validado con modelo simulado, autenticación/instalación y ausencia de efectos; suite de conversación y BMB.
Pendiente: despliegue QA aislada y smoke de saludo real. No se acredita proveedor real ni bloqueo físico con fixtures.
