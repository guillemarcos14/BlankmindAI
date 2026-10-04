# Paleta activa y pantalla protegida

Con bloqueo activo, el estado de protección gobierna el esquema de toda la app: fondo `#292929`, texto `#FFFFFC`. Home/menú, círculo UIKit, secciones y controles heredan la inversión. Las tarjetas claras usan texto oscuro; al desactivar se restablecen tarjetas oscuras/texto claro. Alertas conservan su color semántico.

La landing activa muestra `hold the screen to unblank` inmediatamente, incluida apertura desde widget. El círculo permite menú/chat; su zona queda fuera de la superficie de hold. El hold conserva20s, pulsos1s y cooldown60s; soltar reinicia progreso. Abrir la pantalla no inicia hold/hápticos. Hard protection conserva bloqueo manual/emergencia y no promete un hold permitido. La transición a activo cierra la sección/menú, pero no corta la conversación presentada.

Modelo, prompts, peticiones, acciones y persistencia de BMB sin cambios. El saludo/backend QA de94 sigue disponible; archive94 ya generado no contiene esta corrección y no se ha subido (cuenta Apple ausente).

Validación inicial harness69/69; cierre tras documentación68/69 con baseline `tmp/product-harness/baseline-active-palette.json`, diff0dcf4e4 y scope sin infracciones. Solo gate previo de producción falla por replay insuficiente/0 casos físicos. CI nativo y compilación/capturas pendientes de completar. No prueba física ni distribución nueva.
