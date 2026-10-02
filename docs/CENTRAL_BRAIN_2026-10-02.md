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

## Reanudación de release — 2026-10-02

En MacinCloud FF368 se generó el archive `1.9 (86)` de `904fa1e`, con `ARCHIVE SUCCEEDED`, en `~/blankmind-release-20261002/Blankmind86-904fa1e.xcarchive`. No se distribuyó: usa el backend productivo anterior.

El replay original `tmp/bm-semantic/central-brain-904fa1e-active.json` completó 200 trayectorias y 925 turnos con modelo activo, cero fallos funcionales y fuente limpia/estable. La equivalencia visible quedó pendiente. El juez independiente `central-brain-904fa1e-judge.json` revisó 300: 258 excelentes, 42 aceptables, cero deficientes/graves. Se detuvo por HTTP429 `insufficient_quota`; faltan625 y no autoriza release. No se reutilizó el juez histórico porque su módulo no coincide. El replay posterior del candidato QA se conserva como fallido, con cero turnos de modelo por cuota; no sustituye al original ni se presenta como aprobado.

Se añadió una configuración nativa exclusiva de QA: `BLANK_PRIVATE_STAGE_QA` habilita una cookie de acceso solo para HTTPS y el host exacto de staging. Las builds normales ignoran esa configuración. La cookie procede del secreto local cifrado, nunca de Git. `tools/run_private_stage_qa_tests.js` compila y prueba ambos modos y rechaza hosts productivos/externos, HTTP e inputs inválidos. La configuración externa cambia la URL y el número a87; no relaja la protección de staging. La transferencia del archivo a Mac no se completó: el selector RDP no abrió y el navegador bloqueó el puente local; no se omitieron esos controles. No hay archive QA87 ni subida nueva a TestFlight.

Reanudar tras reponer créditos: congelar el candidato final y ejecutar una sola preflight antes de otro replay. Terminar/reutilizar dictámenes solo con todos sus hashes iguales; conservar reportes incompletos y fallidos. Preparar la build privada contra staging, comprobar Apple/StoreKit y los20 casos físicos, y pasar el gate existente antes de cualquier publicación productiva. Firmar o compilar no prueba Screen Time físico.

## Límites y paso físico

La app conserva historia local limitada a las sesiones presentes en el dispositivo. No hay reconstrucción entre dispositivos ni lectura libre de uso real por aplicación. El acceso premium observado no equivale a datos de facturación. Los informes incompletos se identifican; minutos protegidos no se presentan como tiempo real recuperado.

Producción continúa con el backend y TestFlight 85 anteriores. Para distribuir esta versión hace falta archive firmado y comprobar en iPhone permisos, un bloqueo iniciado por chat, cambios de horarios, errores nativos, aislamiento al cambiar cuenta y StoreKit. El gate físico existente sigue pendiente; CI y staging no lo sustituyen. La migración 026 y el runtime se publicarán juntos al superar el gate, mediante las herramientas de integración.
