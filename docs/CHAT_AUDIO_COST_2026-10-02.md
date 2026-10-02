# Chat, audio y coste API — 2026-10-02

Solicitud: analizar gasto API, voz transcrita por modelo sin dictado visible, conversación natural y compositor inferior que respete el teclado.

## Auditoría de consumo

Fuente local: `tmp/bm-semantic/central-brain-904fa1e-active.json`. Evaluación de desarrollo: 925 turnos, 200 trayectorias. Las 920 métricas de extracción con uso informado suman 829.581 tokens de entrada y 95.454 de salida; dentro de la salida, 53.330 son razonamiento. Entrada cacheada: 13.639 (1,64 % de la entrada). Son al menos 925.035 tokens, unos 1.005 por extracción registrada. No sumar razonamiento por segunda vez. No incluye solicitudes canceladas sin usage, conversación/redacción ni juez. El informe separado de juez contiene 300 revisiones con gpt-5.6-sol; no conserva usage y no permite calcular su factura.

Esta batería usa fixtures WhatsApp: no mide tráfico real, ni incluye el router adicional del cerebro app. La app invoca router y después extracción o conversación según ruta; la generación operativa natural puede añadir una llamada. El coste procede del número de evaluaciones, contexto repetido, razonamiento, reintentos por demora y múltiples fases, además del precio del modelo. No hay export de facturación ni telemetría completa de clientes: no se atribuye todo el gasto a una causa ni se inventa importe en euros.

Medidas: no repetir batería pagada en esta tarea; pruebas sintéticas dirigidas. Retirado nonce aleatorio de redacción. Prompt principal de conversación app reducido de 3.164 a 933 caracteres (70,5 % menos en ese bloque; no equivale a 70,5 % de ahorro total de tokens). Telemetría segura de usage por fase/modelo en runtime; no incluye audio, prompts, conversaciones o credenciales. No se cambia el modelo o razonamiento sin comparación de calidad. La mejora de naturalidad operativa añade generación: no se presenta como ahorro neto demostrado. Las evaluaciones completas siguen siendo necesarias para acreditar la release, pero deben reservarse al candidato congelado.

## Implementación

El micrófono graba AAC mono de 24 kHz, máximo 90 s, con ondas basadas en potencia real. Al enviar, backend autenticado Apple/instalación convierte el audio mediante `/v1/audio/transcriptions`, modelo configurable `OPENAI_TRANSCRIPTION_MODEL` (default `gpt-4o-mini-transcribe`). El texto transcrito se envía como turno; no se introduce en el TextField. Se conserva el borrador separado. Cancelación/cambio de sesión invalida callbacks; el archivo temporal se elimina al completar o cancelar. Los fallos de transcripción permiten reintentar el audio mientras la vista sigue abierta. Backend limita formato/tamaño a 2 MB; silencio/fallo no inicia acciones.

Referencia oficial consultada: https://developers.openai.com/api/docs/guides/speech-to-text

Chat usa `safeAreaInset(edge: .bottom)` y el área segura de teclado SwiftUI; Home enfocada permanece al pie. El teclado controla la transición nativa y se conserva Reduce Motion. Pendiente comprobar interacción física.

App/WhatsApp comparten motor y tono base, pero no configuración idéntica: app tiene router, consultas y ejecución nativa; Early Access WhatsApp usa otro recorrido. Se eliminan atajos conversacionales deterministas de la app y se habilita redacción operativa contextual, también en español, con instrucciones nativas sin notificación inventada. Se mantiene validación de hechos/acciones y respuesta de respaldo cuando la generación no la supera. Mayor libertad de expresión no significa ejecución aleatoria. Consultas verificadas y límites de ejecución siguen acotados; no se promete autonomía fuera de herramientas disponibles.

## Validación

Pruebas audio y naturalidad simuladas, harness con baseline y scope; CI iOS requerido. No se acredita calidad generativa real con mocks, ni firma, TestFlight o prueba física con compilación de simulador. No se despliega producción ni se modifica QA89 instalada en esta tarea.
