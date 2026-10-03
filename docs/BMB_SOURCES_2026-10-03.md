# Fuentes personales consultables por BMB

Inventario de código y esquemas, no afirmación de que una cuenta tenga todos estos datos. Todas las lecturas se limitan al UUID autenticado o al anonymous ID de su vínculo verificado; el modelo nunca elige propietario, tabla, SQL ni credenciales. Las filas anónimas previas sin vínculo verificado no se mezclan con otra cuenta.

| Fuente | Evidencia disponible y cobertura | Permiso / límite |
|---|---|---|
| Snapshot nativo | Protección actual, selección/permiso, pausas/vacaciones, límites/filtro, ventanas con fecha/zona/recurrencia, presencia y chat | Cuenta activa; órdenes reactivas exigen snapshot ≤2 min. Ejecución proactiva vuelve a comprobar el dispositivo |
| Cuenta local | Sesión, acceso premium, productos con entitlement observado, prueba referida y su fin, referidos, acceso demo identificado | Observación local de StoreKit/app; no factura, medio de pago ni fecha de renovación Apple |
| `history` | Turnos app completos y texto, recientes o antiguos, fecha y autor | UUID autenticado; 40 filas/página. Reset/olvido corta personalización previa; lectura anterior solo con petición actual explícita |
| Memoria | Siete categorías, literal, fuente/turno/fecha; corrección y tombstones | UUID autenticado; solo declaraciones actuales, confirmadas junto al turno |
| `sessions` | Inicio, fin, pausa registrada, causa y modo | UUID autenticado; archivo local completo por páginas de 2.000, lectura de 40 filas/página |
| `protection_statistics` | Unión de intervalos, pausa, sesiones y salidas anticipadas en rango exacto | Máximo 10.000 filas solapadas por consulta; declara cobertura parcial/truncada/frescura, nunca extrapola uso o tiempo ahorrado |
| `onboarding` | Nombre, franja de edad, objetivo/perfil, horas declaradas, momento débil, idioma y plan seleccionado | Vínculo verificado, `data_consent=true`; declaración del usuario, no medición |
| `features` | Payload/insight/rango de señales de bienestar previamente persistidas | Vínculo verificado y consentimiento; origen/confianza dependen de la fila. Credenciales y tokens eliminados |
| `wellness` | Señal, valor/fecha/fuente | Vínculo verificado; distinguir autoinforme de medición por `source` |
| `wearable_connections` | Proveedor, estado, scopes, última sincronización/desconexión | Vínculo verificado; sin access/refresh tokens ni hash de cuenta externa |
| `wearables` | Features comunes/específicas, frescura y confianza | Vínculo verificado; conectar proveedor no garantiza datos actuales ni cobertura histórica |
| `wearable_outcomes` | Acción/recomendación, resultado, confianza y metadata | Vínculo verificado; no inferir efectos de salud sin evidencia |
| `plan_outcomes` / `recommendation_decisions` | Planes propuestos, decisión, fuente, resultado/score/evidencia | Vínculo verificado; resultados registrados, no objetivos cumplidos por defecto |
| `recommendation_feedback` / `learned_signals` / `learning_changes` | Feedback literal, señales aprendidas con confianza/fuente y cambios de usuario | Vínculo verificado; sin aprendizaje global ajeno. Olvido limita fuentes personales previas |
| `device_signals` | Umbral de uso agregado alcanzado, minutos configurados y hora | Cuenta de la extensión; no total de uso ni por app. Sube en próxima ejecución/sync de la app |
| `events` / `feedback` | Iniciativas BMB, hechos, transporte, recibo nativo y utilidad/hora/frecuencia | UUID autenticado; los estados de transporte no son estados de protección |
| Uso detallado del iPhone | No disponible para exportación al cerebro desde DeviceActivityReport | Restricción Apple; usar la interfaz Tiempo de uso para detalle. No convertir sesiones en horas de móvil |

Las consultas incluyen disponibilidad, motivo, fuente, filas y siguiente cursor. Falta de esquema = `source_schema_unavailable`; falta de identidad = `no_verified_account_link`; cero filas consentidas/en rango se describe así. No se interpreta como cuenta nueva, cero uso o saldo agotado.

Se eliminan claves de token/secret/password/authorization/cookie, conexión, teléfono, cuenta externa y tokens de selección. Hay límites de profundidad/tamaño; el snapshot no vuelca 2.000 sesiones al prompt. El modelo dispone de tres rondas de lectura y una reparación de formato, no SQL libre. Cita solo fuentes/filas que recibió. Una fuente grande requiere rangos/paginación y respuesta con cobertura honesta.
