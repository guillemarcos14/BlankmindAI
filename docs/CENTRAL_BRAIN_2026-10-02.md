# Cerebro central de Blankmind

Blankmind comparte el estado reciente del iPhone desde cualquier pantalla. El modelo interpreta peticiones; los cálculos, la persistencia y la ejecución nativa mantienen su propia autoridad.

## Implementación

1. `BlankBrain.swift` observa sesión, protección y compras; envía permisos, horarios, ajustes y hasta 2.000 sesiones de la cuenta. Cada envío del chat incorpora una observación nueva. La sincronización deduplica estados y evita modificar los publicadores que observa.
2. `bm-brain.js` clasifica consultas de configuración, estadísticas, historial, memoria y cuenta. La ruta de controles conserva el planificador existente. Las consultas usan operaciones acotadas y datos verificables; no se introduce otro agente autónomo ni acceso SQL generado por el modelo.
3. `bm_brain_memories` conserva siete categorías de hechos declarados, con usuario, turno, fuente y fecha. El RPC aplica efectos después del turno duradero, permite correcciones y olvidos y evita que una respuesta antigua reponga un dato eliminado. El olvido también limita la personalización desde mensajes recientes; el historial sigue disponible mediante búsqueda explícita.
4. Chat e inbox traducen acciones mediante `AssistantControl.swift`. Una petición explícita puede aplicar protección sin otro botón, usando la misma comprobación de identidad, caducidad, permisos y resultado nativo. Historial, recuperación tras pérdida de respuesta y desactivación de protecciones conservan aplicación explícita. Contraseñas, compras, borrado y desbloqueos siguen sus flujos propios.
5. `BlankBrainMetrics.swift` y `bm-brain-data.js` calculan unión de intervalos, pausas, periodos y cobertura. Informes y contexto usan sesiones de la cuenta, incluidas semanas locales y cambios de hora. El sistema distingue protección registrada, estimaciones y datos ausentes.

## Validación y despliegue

- Harness con baseline anterior a las ediciones y `--enforce-scope`: 64/64 en feature e integración. Los informes finales están en `tmp/product-harness/` de sus respectivos worktrees.
- Clasificador con proveedor real: 20/20, `tmp/brain/live-router.json`. Es evaluación del router, no del conjunto de conversaciones o de ejecución física.
- PostgreSQL real en CI valida permisos, aislamiento, transacciones, orden de corrección, duplicados y olvidos. Tests Swift ejercitan comandos compartidos, cuentas, métricas, fechas y recuperación del cliente.
- Staging reservado: Supabase `njqbovsmoowkhhsqmitn`, migración aditiva 026 aplicada; no se modifica la historia 001–024. Backend runtime `458c7ff315ef3aeba889cba175c8df84b036fbb4`, Netlify `6abf831459f2caabcaf605e1`; seis ZIPs verificados remotamente. `tmp/brain/cloud-final-458c7ff.json`: 15/15 y limpieza 14/14. Comprueba memoria, corrección, olvido, búsqueda histórica, cuenta, estadísticas, contexto obsoleto y acciones únicas. Observaciones de iPhone y cuentas Apple son sintéticas; no hay ejecución nativa ni recibo de éxito ficticio.
- Compatibilidad anterior: `tmp/brain/legacy-cloud-03f5837.json`, 9/9 y limpieza 12/12. Sin notificaciones, OTP ni entregas a usuarios.

El PR de implementación es #9, basado en la rama iOS actual. La integración vive en `codex/backend-release-central-brain-2026-10-02`. Los informes anteriores, incluidos fallos iniciales, se conservan; no acreditan el runtime posterior.

## Límites y paso físico

La app conserva historia local limitada a las sesiones presentes en el dispositivo. No hay reconstrucción entre dispositivos ni lectura libre de uso real por aplicación. El acceso premium observado no equivale a datos de facturación. Los informes incompletos se identifican; minutos protegidos no se presentan como tiempo real recuperado.

Producción continúa con el backend y TestFlight 85 anteriores. Para distribuir esta versión hace falta archive firmado y comprobar en iPhone permisos, un bloqueo iniciado por chat, cambios de horarios, errores nativos, aislamiento al cambiar cuenta y StoreKit. El gate físico existente sigue pendiente; CI y staging no lo sustituyen. La migración 026 y el runtime se publicarán juntos al superar el gate, mediante las herramientas de integración.
