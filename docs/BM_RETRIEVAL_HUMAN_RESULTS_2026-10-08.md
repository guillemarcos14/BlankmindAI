# Revisión humana: resultados y correcciones

Guillem prefiere la candidata en **15/22 parejas comparables (68,2%)**, frente a7/22 de la referencia. Factuales:12/16 candidata,4/16 referencia. Las otras8:3 candidata,3 referencia y2 incompletas. No son notas de excelencia ni una aprobación de activación: no se recibieron puntuaciones E/A/D. Selección pequeña, dirigida y correlacionada.

Pareja17: ambas respuestas fallaron. Pareja18: una respuesta completó y otra falló; Guillem indicó «Incompleto», sin elección. Se conservan esas dos parejas, sin contarlas como empate o descartarlas del registro.

| Pareja | Elección de Guillem | Variante |
|---|---|---|
| 1 | B | Referencia |
| 2 | B | Referencia |
| 3 | B | Candidata |
| 4 | A | Candidata |
| 5 | A | Candidata |
| 6 | B | Candidata |
| 7 | A | Candidata |
| 8 | A | Candidata |
| 9 | A | Candidata |
| 10 | A | Candidata |
| 11 | B | Referencia |
| 12 | B | Referencia |
| 13 | B | Candidata |
| 14 | B | Candidata |
| 15 | B | Candidata |
| 16 | B | Candidata |
| 17 | Incompleto | Sin preferencia |
| 18 | Incompleto | Sin preferencia |
| 19 | B | Candidata |
| 20 | B | Candidata |
| 21 | A | Referencia |
| 22 | A | Candidata |
| 23 | B | Referencia |
| 24 | A | Referencia |

## Cambios preparados después de la medición

1. Sin dobles guiones ni rayas largas como puntuación de frases.
2. Duraciones≥60min en horas y minutos, omitiendo minutos cero:180min→3h;187min→3h7min. Si el usuario pide minutos, se mantienen minutos. No altera unidades de acciones/datos ni procedencia.
3. Tono cercano y coloquial según el contexto; risas y alguna palabrota cuando encajen, sin forzarlas.

Una instrucción compartida aplica estas reglas al generador normal BMB y al compacto de retrieval. Es un cambio posterior a las respuestas puntuadas: estas preferencias y las mediciones previas no validan automáticamente la nueva redacción. Los outputs originales y sus fallos permanecen intactos. No se ha desplegado ni activado; QA109 mantiene su backend.

Validación local/CI del cambio se registra en PR27. La comprobación de salidas nuevas con proveedor real requerirá un corpus nuevo, sin reutilizar esta selección como holdout.
