# Revisión de acuses preparados — 2026-09-26

El gate local de `bai_release_gate.js` usa `bm_semantic_development_v2.json` y `bm_semantic_development_reviews.json`, con dos repeticiones. Son **48 turnos ejecutados de dos trayectorias distintas**, distribuidas en seis variantes de canal; no son 48 conversaciones independientes ni el corpus de 925 turnos.

El informe inicial `tmp/bm-semantic/development-gate.json` tenía 36 turnos aprobados, 12 sin revisión visible y cero fallos funcionales. Los 12 acuses correspondían a dos pares nuevos de hashes. La revisión encontró una contradicción real: el título «Sending protection» afirmaba un envío aunque el acuse emitía `actions: []`. Se corrigió a «Request prepared» antes de aprobar cualquier hash nuevo.

La revisión definitiva está en `tmp/bm-semantic/prepared-title-final-review.json`; los dos pares con contexto e historial están en `prepared-title-review-pairs.json`. El agente `/root/ios_quality`, que no escribió esta copy, aprobó de forma independiente las tres superficies de texto y voz, título, etiquetas, bullets, followup vacío, acciones, estado e historial. `/root/release_audit` registró sus dos dictámenes exactos y conservó los 36 registros históricos.

| Caso | Equivalencia comprobada |
| --- | --- |
| `Yes` tras corregir 30 a 45 minutos | Conserva inicio inmediato, 45 minutos, una vez y selección canónica. No emite otra orden ni afirma envío o bloqueo físico. Diez ocurrencias: cinco canales y dos repeticiones. |
| `Yes` tras corregir el final a mediodía | Conserva 10:00–12:00, 120 minutos derivados, cada día y horizonte de siete días. No duplica el horario. Dos ocurrencias en iOS. |

La palabra «prepared» acredita solo preparación: el marcador semántico precede a la cola y no prueba entrega, estado pendiente ni aplicación. Si una carrera impide la entrega, una petición completa nueva permite intentarlo otra vez; una confirmación repetida no recrea la acción.

Los dictámenes se vinculan al hash de **todas** las superficies y al hash exacto de la expectativa. No se modificaron el corpus, sus expectativas ni los umbrales. Esta revisión local no acredita un modelo activo, compilación firmada, funcionamiento físico en iPhone, publicación ni aprobación del corpus de 925 turnos. El harness completo y los gates de release siguen siendo independientes.

Verificación posterior: `tmp/bm-semantic/prepared-title-reviewed-48.json` registra **48/48 aprobados, cero fallos y cero turnos sin revisar**, con cero turnos de modelo activo. La ejecución se hizo antes del commit, por lo que `release_eligible` sigue en `false`; este resultado no se presenta como evidencia de una release limpia.
