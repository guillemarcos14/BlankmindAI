# Blankmind — uniformidad de pantallas

Modo Operate. Petición de Guillem: extender el Home aprobado de `0d919a9`
a los interiores y onboarding conservando funciones, datos y políticas.
La restricción anterior de preservar su aspecto queda sustituida.

El Home sigue siendo la autoridad. NeueMontreal-Regular escalable en títulos,
cuerpo, campos, métricas, explicaciones y acciones. Marfil `#FFFEF5`, gris frío
`#D5DBDC`, tinta verde gris `#49544E`; superficie protegida `#26312C`.
Semántica destructiva/errores y Sign in with Apple siguen siendo nativos.

Control y Progress continúan bajo la navegación de tres iconos y subrayado.
La cabecera atmosférica comparte el material y esquinas inferiores del Home;
el contenido usa fondo tonal sólido para leer y editar. Filas de Control
separadas por reglas finas; métricas y selecciones usan superficies marfil
o verde gris de 16pt, sin tarjetas negras. Formularios alineados naturalmente;
solo respuestas/contenido de emergencia se centran. Back vuelve a Control.

Cobertura: Control, Progress, Distractions, Routines, Automatic protection,
Notifications, history, account, emergency, sign-in y permisos de onboarding.
Fechas, switches, steppers, disclosures, selección de Family Controls y
confirmaciones destructivas conservan sus componentes y conducta nativos.
Hold3s para bloquear, hold20s para desbloquear, cooldown60s, hard protection,
recovery, almacenamiento/versionado de preferencias y conversación permanecen.

Dynamic Type: filas y botones crecen, métricas se apilan en tamaños accesibles,
días se distribuyen en rejilla de targets44pt, texto largo se desplaza.
Onboarding deja de medir botones con una fuente distinta o ensancharlos fuera
del viewport. Debug fixtures son sintéticos, sin cuentas/red ni permisos reales.

Baseline: `tmp/product-harness/baseline.json`, creada antes de editar.

La revisión independiente inicial se hizo sobre 39 capturas nativas de `f027e21`.
Se corrigieron subtítulos recortados, reflow de riesgo en Progress, target/VoiceOver
de Protect, contraste secundario, recuperación de preferencias sin formulario
vacío, estado deshabilitado/confirmación de Emergency y documentación del sistema.
La primera verificación de correcciones en `b1790a1` resolvió seis de los siete
puntos; quedó demostrar el target de Confirm unlock. `e1497c5` coloca el frame
44×44pt y contentShape dentro del label y prueba confirmación/cancelación nativas.

El archivo final `Blankmind102-Final-e1497c5.xcarchive` compila Release en FF368
con ARCHIVE SUCCEEDED y firma codesign deep/strict válida. Info.plist confirma
1.9(102); endpoint y autenticación QA privados iguales a101, sin publicar valores.
Solo cambia el número de build en la configuración privada.

CI iOS [37458575394](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37458575394)
correcto en `e1497c58c3c77adca8fd389cfcffc2a780f466e2`: recovery nativo,
build Simulator, cinco XCTest/0 fallos y 40 capturas nativas. Incluye selección
de tres destinos, scroll de respuesta larga, edición/cierre de Form, Save con
Dynamic Type máximo y Confirm unlock44×44pt seguido de Keep Blocking.
Evidencia local `.impeccable/review/uniform-e1497c5/`, manifiesto con SHA256,
40 PNG/ninguna vacía y siete contact sheets derivados; logs en
`tmp/uniform-native-e1497c5.log`. BM Harness Gate37458580572 correcto.

Pruebas dirigidas de conversación/API y audio mock correctas. Harness baseline
con diff-base `0d919a9` y enforce-scope mantiene68/69, sin infracciones; solo
`release_gate_quick` previo exige replay/20 casos físicos. No rebajar ese gate.

Veredicto independiente final: ship para las siete correcciones puntuadas.
Último veredicto `tmp/uniform-finish-verdict-e1497c5.md`, precedido por
`tmp/uniform-finish-review-f027e21.md` y `tmp/uniform-finish-verdict-b1790a1.md`.
La última verificación se limita al punto pendiente6; mantiene las seis
resoluciones previas y no constituye una nueva auditoría completa.

Subida confirmada por Xcode: App upload complete / Blankmind1.9(102) uploaded,
exclusivamente TestFlight Internal Only, 2026-10-06. Evidencia
`tmp/uniform-testflight/testflight102-uploaded.jpg`; selección interna y archive
verificado en la misma carpeta. Pendientes procesamiento Apple, acceso tester
y prueba física. No declarar Simulator como QA física; producción/backend intactos.
