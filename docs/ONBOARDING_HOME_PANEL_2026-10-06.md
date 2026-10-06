# Onboarding dentro de la tarjeta de Home

Petición de Guillem: el contenido del onboarding debe vivir dentro de la tarjeta con degradado de Home. El acceso con Apple y la configuración del dispositivo comparten ahora `MinimalOnboardingPanel`, el material `MinimalAtmosphere`, la altura calculada de Home, esquinas inferiores de 56pt y el fondo gris frío inferior.

La columna conserva alineación natural, Neue Montreal, título de 32pt, cuerpo de 17pt, máximo de 400pt y margen horizontal de 28pt. Se centra cuando cabe y se desplaza dentro de la tarjeta cuando crece. El título de configuración separa «Set up» y «Blankmind» a tamaños de accesibilidad. Los controles activos usan marfil/tinta verde gris; los completados conservan check y estado accesible. Apple sigue siendo el control nativo blanco, 50pt de alto. La barra de estado se oculta como en Home.

El sombreado de onboarding aumenta a 44% por la mayor densidad y el desplazamiento de texto sobre zonas claras. En la región conservadora del iPhone SE (contenido x28..347pt, y124..511pt), el contraste mínimo de marfil sobre el estado completado (relleno marfil al 12%) es 4,73:1. El sombreado de Home continúa al 28%; no se altera su geometría, navegación ni voz.

Se conservan sesión/vinculación Apple, selección de apps, permisos, acciones, notificaciones, analítica y finalización automática. El modal de cuenta con Cancel mantiene su arquitectura tonal.

## Evidencia

- Runtime inicial `db9f1ec`: CI [37480305966](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37480305966), build y siete XCTest correctos, incluida accesibilidad de acciones con texto máximo. Primera inspección de capturas: una imagen compacta de cuenta mostró la pantalla de lanzamiento y se descartó; el resto permitió revisar geometría, color y crecimiento. No se atribuye esa captura a un fallo del producto.
- Runtime final `d8c1c3d`: MacinCloud BUILD SUCCEEDED e instalado/abierto en iPhone17Pro/iOS26.3. Prueba: `tmp/onboarding-home-panel/macincloud-final.png`. Confirmación nativa CI [37483477613](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37483477613) completada con SUCCESS: build Simulator, pruebas nativas y repetición del XCTest de onboarding con texto máximo correctos. Las once PNG finales de Simulator en `.impeccable/review/onboarding-final/` están validadas e inspeccionadas: Home de referencia y ambos pasos, apariencias clara/oscura y texto máximo en iPhone estándar, más ambos pasos y texto máximo en iPhone SE 3.
- Harness `ph_1791298756322_6cdb0dc9`: 68/69 comandos, cero infracciones con baseline y diff `3bbd0e3`. Fallo previo `release_gate_quick`: falta evidencia física/replay revisado; no se relaja.

La primera revisión `.impeccable/review/onboarding-review.md` pidió corregir únicamente documentación y persistencia: reglas de onboarding obsoletas y CI todavía descrito en curso. No encontró defectos visuales materiales. La continuación documental puntúa ambos hallazgos como resolved y dispone ship para esas dos correcciones; runtime y once capturas permanecen inmutables. No amplía la certificación a autenticación/Screen Time físicos, release readiness ni TestFlight.

Las capturas son producción SwiftUI con fixtures Debug nativas. No certifican Apple/Screen Time físicos ni una distribución nueva en TestFlight. Los modos manuales de CI `capture=onboarding` y `ui_tests=onboarding` permiten confirmar una corrección local después de una pasada completa correcta; push/PR conserva pruebas completas por defecto.
