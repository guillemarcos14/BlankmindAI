# Voz y texto sincronizados — 2026-10-08

Objetivo: las respuestas a una entrada hablada muestran palabras al avanzar el audio; output sin Listen, altavoces, mute ni AI-generated voice. El micrófono de entrada/detener permanece. La preferencia mute por cuenta se conserva mediante Spoken replies en el menú contextual del micrófono, sin controles añadidos al output ni altavoces.

Rama: codex/voice-text-sync-2026-10-08, basada en c3dd08a (app real109 y corrección sueño QA). No sustituye backend por una rama anterior.

## Implementación

La respuesta final persistida sigue siendo la única fuente. Conserva gpt-4o-mini-tts/marin. Una petición synchronized:true obtiene PCM completo y tiempos de palabras mediante whisper-1/verbose_json; se envían cues con offsets UTF-16 del texto original, después PCM y end. Clientes anteriores sin synchronized conservan streaming anterior. No hay migraciones, nuevas variables ni almacenamiento de audio.

iOS no muestra borradores de los nuevos turnos hablados. Descarga audio y cues antes de reproducir; revela texto cada20ms según sampleTime/sampleRate de AVAudioPlayerNode, no según velocidad de escritura ni reloj de red. Puntuación/Unicode/texto original se conservan. Cierre/background/interrupción/cambio de cuenta cancelan; error o desalineación devuelve texto íntegro sin voz incorrecta. Entradas escritas/historial/recovery siguen silenciosas.

Se exige correspondencia lexical normalizada; numerales pueden representar varios términos hablados anclados al comienzo del grupo. Numerales consecutivos ambiguos y transcripciones lexicalmente distintas rechazan audio. Tiempos Whisper son estimaciones del proveedor, no una garantía de desviación cero. Latencia inicial y coste aumentan por preparación/transcripción. Dos muestras sintéticas reales marin/Whisper con números/horas alinean correctamente: ES12cues/6,30s audio, preparación3941ms (TTS2266+alineación1675); EN11cues/4,55s, preparación3181ms (TTS1826+alineación1355). Medidas tras respuesta ya redactada; no son p50/p95 ni incluyen red iPhone/render ni acreditan coste facturado. No empieza a hablar durante la generación del modelo: voz y texto empiezan juntos tras preparar audio.

Referencia oficial: https://developers.openai.com/api/docs/guides/speech-to-text (timestamps word con whisper-1).

## Validación

Proveedor real ES/EN con7horas/23:30/10:30:2/2 PASS; metadatos sin audio en tmp/product-harness/live-voice-alignment.json. Tests locales de backend/alineación: PASS (ES/EN, números/horas, UTF-16/emoji, WAV, PCM acotado, orden, borrado durante alineación, mismatch). Harness78/78 y scope sin infracciones contra c3dd08a: ph_1791467380846_73474e63. Primera pasada77/78 con árbol sin commit; repetición tras snapshot limpio pasa el gate completo. La prueba física de sincronía no queda acreditada por el harness.

Pruebas nativas añadidas: buffering sin salida prematura, silencio inicial, reloj simulado, palabras futuras ocultas, Unicode y tiempos incompletos. XCTest comprueba ausencia de Listen/altavoces/aviso y conserva micrófono/nav. CI nativo/clock tests PASS en0eb486d (37787570746); compilación/suite UI del candidato final7926cda en curso; prueba real ES/EN de sincronía/latencia/números en iPhone pendiente.

## Handoff Backend Cloud

Archivos: bm-voice-output.js, nuevo bm-voice-alignment.js; iOS AssistantAppView/AssistantVoicePlayback; tests/contrato/documentación.
Migraciones Supabase: ninguna. Variables: ninguna nueva; BM_VOICE_ENABLED/OPENAI_API_KEY existentes.
Publicar módulo de alineación junto al endpoint compatible desde integración actual QA. Después distribuir app nueva;109 no contiene estos cambios. Sin deploy ni TestFlight en esta conversación.
Riesgo: nueva transcripción por respuesta, demora inicial y fallback textual ante falta de alineación. Audio efímero; revalidar borrado/cuenta tras transcripción. No se envía contenido a logs.
