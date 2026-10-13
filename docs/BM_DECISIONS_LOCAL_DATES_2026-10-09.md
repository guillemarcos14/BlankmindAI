# Fechas locales y evidencia conservada

Continuación de7dc337a, sin reiniciar presupuesto ni resultados. CorpusV2 original conserva200turnos,199respuestas de proveedor y1fallo bmb_invalid_model_json después de las dos solicitudes permitidas. No se repite el intento fallido. La respuesta inválida no quedó almacenada; no se inventa una causa de sintaxis más específica.

Review independiente conservada en tmp/decisions-production/release-v2-7dc-quality.json:158/200,118excelentes/26aceptables/14deficientes,13fallos duros y1fallo funcional del conjunto. La primera parada148también se conserva. El techo19USD detiene nuevas reservas: conocido18,59686453USD, reserva18,93071843USD. La revisión no está completa y no aprueba activación.

Los defectos de fecha contrastados desplazan al día UTC los registros de las01:00locales. La corrección añade local_date/local_date_timezone calculados por servidor, conserva measured_at y traduce los límites YYYY-MM-DD a medianoche de la zona consultada; to sigue siendo exclusivo. El modelo recibe expresamente la diferencia entre fecha local y timestamp UTC. Tests verifican Madrid/UTC, cambios de horario y límites de lectura.

Se corrigen tres rechazos léxicos demostrados: un desglose de noches válidas junto a la media, «unavailable, not0minutes» y las00:00del límite semanal. El oráculo solo acepta duraciones de filas válidas dentro del periodo y horas de límites reales. Sigue rechazando500min inexistentes, cero afirmado ante datos ausentes, negación del cero registrado y12:34inventadas. Nada pasa sin review exacta independiente;42mutaciones siguen impedidas. Los18fallos brutos del replay7dc no se reescriben.

El adaptador nuevo usa IDs UUID sintéticos con formato real de las tablas, en lugar de sleep-0/1/2. El goldV2 no cambia. La nueva fuente y sus cambios de fixtures requieren su propia ejecución pagada; los outputs anteriores permanecen vinculados a7dc.

QA7dc: deploy6ac9225a875ca3fe136b835f,10hashes remotos correctos. El smoke remoto completo pasó4checks de autenticación/aislamiento, pero send devolvió503; limpieza completa. Se conserva el fallo y0,10USD opacos reservados, sin inventar usage ni causa. No equivale al smoke infrastructure-only ni a un envío válido con snapshotBMB actual.

Producción OFF; Jev OFF. Pendientes42reviews originales, ejecución y comparación amplia de la nueva fuente, diagnóstico del envío remoto/JSON inválido, revisión humana, build exacta y20casos físicos. MacinCloud no está abierto. Apple Review y voz fuera de alcance.
