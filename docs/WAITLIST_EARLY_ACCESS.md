# Blankmind Early Access temporal

## Alcance

Esta capa sustituye temporalmente la entrada conversacional de Blankmind para todas las altas. No enruta cohortes y no importa ni ejecuta ninguna capacidad del producto final. Su único objetivo es conocer a la persona de forma natural antes de darle acceso.

La web, Supabase, Netlify y los senders existentes de WhatsApp/Twilio siguen siendo los mismos. El producto agéntico queda intacto y dormido mientras el webhook apunte a `waitlist-agent`.

## Flujo

1. La persona abre `/early-access`, elige WhatsApp o Message, verifica su teléfono por SMS con `waitlist-auth` y acepta explícitamente guardar la conversación y recibir mensajes en el canal elegido. El OTP de la web no pasa por `app-auth` ni forma parte de la app iOS.
2. `waitlist-start` verifica el JWT y que el teléfono pertenece a ese usuario.
3. Se envían exactamente dos mensajes deterministas, una vez cada uno. En WhatsApp se entregan mediante plantillas Twilio aprobadas; en SMS se envían como mensajes Twilio normales:

   - `Hey, I’m Blankmind. Tell me a bit about yourself.`
   - `What should I call you? How old are you? What’s a normal day like for you? A voice note’s fine too, if that’s easier.`

4. Desde la primera respuesta, `waitlist-agent` responde primero al contenido recibido y conversa sin guion ni orden fijo. Después envía una sola vez la aclaración de disponibilidad. Si la persona pregunta si puede bloquear apps ahora, la respuesta conserva la negativa correcta y añade una segunda burbuja explicando que esto es una demo de early access, que está en la waitlist y que la app completa estará disponible para descargar el 1 de octubre.
5. Si llega un audio, se descarga y transcribe en memoria. No se conserva el archivo; solo el texto transcrito.
6. Cada turno extrae únicamente hechos explícitos y guarda evidencia, confianza, estado y correcciones. La conversación usa el perfil actual, pero nunca expone que existe un checklist.

## Límites conversacionales

- Habla en primera persona y en inglés, con tono cercano de asistente personal.
- No da consejos, planes, diagnósticos, promesas ni ejecuta acciones del producto final.
- No solicita contraseñas, direcciones, datos financieros, diagnósticos médicos ni atributos sensibles.
- No toma posición ni invita a debatir guerras, aborto, elecciones, partidos o religión polarizante. Marca un límite breve y vuelve a la experiencia cotidiana de la persona.
- `STOP` retira el consentimiento y detiene toda nueva persistencia.
- Una petición de borrado requiere confirmar con `DELETE` dentro de 24 horas y elimina perfil, mensajes, hechos y eventos asociados.

## Datos

Las migraciones `019_waitlist_early_access.sql`, `020_waitlist_channel_openings.sql` y `021_waitlist_availability_notice.sql` crean tablas y flags de entrega separados del producto final:

- `waitlist_users`: identidad verificada, consentimientos y estado del recorrido.
- `waitlist_messages`: texto entrante, transcripciones y respuestas.
- `waitlist_facts`: hechos explícitos versionados con evidencia y correcciones.
- `waitlist_events`: métricas operativas sin lógica de producto final.
- `waitlist_inbound_claims`: idempotencia y recuperación de webhooks.

Todas tienen RLS y solo son accesibles desde el backend con service role. La vista `waitlist_current_profile` expone el perfil vigente para análisis interno.

En cada turno se conserva el mensaje entrante completo y, en paralelo, se extraen todos los hechos explícitos que contenga, no solo el dato utilizado para la respuesta. El perfil contempla identidad primaria (`preferred_name`, `age`, `age_band`, `email`), trabajo/estudios/rutina, entorno, intereses, responsabilidades, relaciones, energía, relación con el teléfono, aplicaciones, contenido, momentos, disparadores, frecuencia, impacto, sentimientos, intentos previos, objetivos y cambio deseado. Cada hecho conserva evidencia, mensaje de origen, confianza, fecha y versión anterior cuando se corrige. Las listas se acumulan sin perder valores previos salvo que el usuario las corrija o retire explícitamente.

La memoria de temas preguntados y la prevención de preguntas repetidas se aplican solo internamente. No se muestran resúmenes, checklists, menús ni frases de redirección meta; cualquier cambio de foco debe surgir de forma natural de la respuesta anterior.

La conversación usa objetivos internos suaves, no un cuestionario visible. Cada turno responde primero a la historia que la persona acaba de contar y, solo si encaja, continúa hacia el siguiente objetivo relevante: identidad, vida diaria, relación con el móvil, impacto o cambio deseado. Nombre y edad tienen prioridad de cobertura, pero nunca desplazan abruptamente una historia útil sobre la rutina o el teléfono. Cuando el contexto esencial ya está cubierto, o tras una conversación suficientemente rica, BM deja de generar preguntas nuevas y responde de forma natural; no anuncia que ha terminado ni muestra un resumen. Si la persona sigue escribiendo, la conversación puede continuar sin reiniciarse.

## Activación

1. Integrar esta rama mediante el flujo de Backend Cloud y aplicar las migraciones `019`, `020` y `021`.
2. Las plantillas actuales de WhatsApp contienen el texto exacto anterior y están enviadas a aprobación; no activar la prueba física de apertura hasta que Twilio marque ambas como `approved`.
3. Configurar las variables `WAITLIST_*` documentadas en `.env.membership.example`, además de las credenciales existentes de Supabase, OpenAI y Twilio. SMS usa `TWILIO_MESSAGING_SERVICE_SID` o `TWILIO_FROM_NUMBER`; WhatsApp conserva sus plantillas aprobadas.
4. Desplegar Netlify y apuntar temporalmente el webhook entrante del número existente a `/.netlify/functions/waitlist-agent`.
5. Verificar alta, dos mensajes iniciales, texto, audio, duplicados, `STOP`, exportación y borrado con un teléfono interno.

No se debe activar `WAITLIST_ALLOW_FREEFORM_OPENING` en producción. Las conversaciones iniciadas por la empresa requieren plantillas aprobadas.

## Rollback

Volver el webhook a su endpoint anterior y restaurar el deploy previo de Netlify. Las tablas `waitlist_*` pueden mantenerse para conservar los consentimientos y datos ya captados; no es necesario borrarlas ni tocar las tablas del producto final.
