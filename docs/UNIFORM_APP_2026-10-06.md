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
Validación nativa y revisión pendientes; no declarar Simulator como QA física.
TestFlight pendiente de firma/upload desde MacinCloud; producción/backend intactos.
