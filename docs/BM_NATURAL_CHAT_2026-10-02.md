# Conversación y acciones en app — 2026-10-02

Candidato del PR #11, modelo gpt-5.6-luna conservado. Sin deploy, compilación MacinCloud ni distribución. La QA89 instalada sigue con el runtime anterior.

El router clasifica la intención del turno y su idioma, con la petición pendiente como contexto. Conversación y relatos no conceden permiso para actuar. Una respuesta a un dato pendiente puede completar la acción original sin otra confirmación. Una desviación conversacional conserva exactamente el estado pendiente sin consumir su entrega. La cancelación cierra la petición, incluidas “forget the block” y “olvida el bloqueo”. Preguntas y saludos no pueden convertirse en memorias nuevas.

La app utiliza el camino conversacional compacto para conversación libre. Se eliminaron instrucciones contradictorias de inglés obligatorio. El idioma del turno sobrevive a la normalización del contexto; inglés por defecto, castellano cuando corresponde y respuestas neutras heredan el hilo. El tono común pide lenguaje cotidiano como WhatsApp, sin encabezados, dos puntos narrativos, punto y coma o explicación de pasos internos. La salida conserva horas como 18:30.

Se corrigieron dos causas reales de texto rígido. El backend reemplazaba la redacción del modelo por una plantilla y una frase genérica de autoaplicación. Además, el contrato validaba pasos de notificación WhatsApp dentro de la app, contaminando el respaldo y rechazando respuestas naturales válidas. Ahora hay flujos app para aplicación automática, botón, permisos y selección. Solo una respuesta validada conserva su redacción operativa mediante una prueba HMAC interna ligada al texto y las acciones. Cambiar el texto o las acciones invalida esa prueba. Éxito sigue requiriendo recibo nativo. Los controles rechazan horarios, minutos, pasos, modo estricto y estados de ejecución inventados; las acciones no provienen de la prosa.

Evidencia real acotada en BM_NATURAL_CHAT_EVIDENCE_2026-10-02.json. Ocho casos con proveedor real pasan clasificación, idioma y respuesta completa cuando corresponde. Incluyen dato pendiente de 30 minutos, relato sin acción, cancelación, petición española de 25 minutos, pregunta sobre hábitos, instrucciones citadas y datos incompletos. No se encolaron acciones ni se escribieron memorias. Se revisaron los textos generados. Son comprobaciones dirigidas, no una medición estadística de excelencia ni prueba de bloqueo físico.

Durante la iteración, el router amplio tuvo 19/20 aciertos y el flujo completo detectó redacción de WhatsApp, cancelación incompleta y una pregunta convertida en memoria. Se repararon las causas y se verificó el conjunto dirigido completo; no se presenta aquel primer resultado como 20/20. Las pruebas de regresión cubren contrato real, texto conservado, alteración del HMAC, datos inventados, idioma, cancelación y desviación pendiente sin otra extracción. Las llamadas pagadas quedan fuera del harness/CI por defecto.

Pendiente probar el candidato en iPhone, integrado con backend y permisos reales. Repetir evaluación amplia solo con objetivo y presupuesto definidos. Referencia de herramientas del proveedor https://developers.openai.com/api/docs/guides/function-calling.

Validación local final del runtime b14ab11: product harness66/66, baseline-natural-brain.json y --enforce-scope, informe ph_1790952522596_8dcae7a1. El gate de desarrollo pasa; no demuestra release físico.

Cierre adicional: el paso de localización cortaba las respuestas conversacionales españolas a320caracteres. La app conserva ahora el mismo límite de1200caracteres de su redacción original y una regresión verifica que la respuesta larga termina completa. No cambia el presupuesto de salida del modelo ni añade llamadas.
