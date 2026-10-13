# Continuación con techo24USD y gold contrastado

Guillem añade5USD de gasto: techo acumulado24USD, no26. Ledger, resultados, reservas y checkout anteriores conservados. La review original V2/7dc termina200/200:147excelentes,38aceptables,15deficientes;13fallos duros y1fallo funcional. No aprueba producción. Conocido19,21173853USD; reservado19,54559243USD antes de nuevas pruebas.

Dos rechazos de protección parcial se contrastan con `bmb-sources`: la fuente devuelve `partial:true`, incluso cuando no hay sesiones persistidas. El goldV2 omitía ese campo. Se conserva su dataset y todos los veredictos; no se convierten en aprobaciones retrospectivas. GoldV3 nuevo incluye las estadísticas realmente devueltas y distingue cobertura del registro de ejecución física. Cien casos se contrastan con la lectura real del servidor, sin proveedor.

GoldV3 también conserva timestamps UTC originales junto a fechas locales y zona. Las expectativas numéricas siguen independientes del candidato:421/482/543min de sueño y0/30/75/90min de protección según fuentes y periodo. Los200casos conservan cobertura única. No cambia runtime5b1 ni baja gates. Nueva ejecución/review exacta requiere nuevos artefactos ligados a esta fuente y dataset.

QA5b1: diez hashes remotos e infraestructura4/4 correctos; envío con contexto BMB actual pendiente. Producción y Jev OFF. Comparación amplia actual, revisión humana, build y veinte pruebas físicas siguen pendientes. Apple Review y voz fuera de alcance.
