# Auditoría de conversaciones, integración, compilación y operación de la 119

Fecha: 15 de octubre de 2026, Europe/Madrid. Alcance: cambios de Blank discutidos el 14 de octubre, desde las 00:00 hasta las 24:00 locales. Auditoría sin modificar el producto, publicar, activar funciones ni consumir modelos o voz.

## Dictamen

La build 1.9(119) corresponde a la fuente integrada `aa4f288784fcef0a99895d6f4be148bf302e84ee`. No he encontrado una rama nativa de ayer olvidada en ese archivo. La fuente CORE, el cliente integrado, el cliente probado en CI y el cliente compilado comparten el árbol `bbfd5ebb229cf89ffd4ecbb90ee8e17aa16aaf2d`.

Eso no permite afirmar que todos los resultados pedidos estén funcionando. Hay dos discrepancias demostradas: la retirada de capacidades antiguas quedó incompleta en el servidor y la activación de la nueva capa conversacional sigue pendiente. El ciclo real con Watch tampoco tiene evidencia productiva registrada.

El widget sí está retirado del archivo. Guillem informa el 15 de octubre que el elemento que permanecía en su pantalla no tenía candado, mostraba un cuadrado, no respondía ni abría la app y, tras eliminarlo, ya no se puede añadir. Esto respalda que era un resto visual de la instalación anterior; el mecanismo interno de iOS no se ha inspeccionado. Incidencia visible cerrada por la prueba del usuario, sin reinstalar ni borrar datos.

## Cobertura de conversaciones

Inventario de chats activos y archivados, metadatos locales en modo lectura, historial por las herramientas de la app y registros JSONL originales filtrados por fecha. Se localizaron 11 conversaciones relevantes y 14 archivos de sesión asociados. La extracción conserva 143 registros de entrada/salida; incluye envoltorios de contexto y 11 activaciones automáticas, por lo que no representa 143 peticiones humanas. No se usó únicamente el resumen de Blank Brain. No se enviaron mensajes a otras conversaciones.

| Conversación | Petición o resultado de ayer | Cruce realizado |
|---|---|---|
| Chat (`01a139ac…`) | Corregir acceso a BM con Sample sleep sin Watch | Corrección `0850cf3`, pruebas de setup, cliente final y compilación 119 |
| Evaluar análisis de sueño en Blank (`01a139b7…`) | Determinar si existía revisión autónoma | Estado anterior cron OFF contrastado con el cron publicado actual |
| Esquematiza el modelo de Blankmind (`01a1399e…`) | Explicar Decisions/conversación/acción | Conversación de análisis; subordinada al esquema posterior aprobado |
| Model Core (`01a139c9…`) | Implementar descanso medido y depurar wellness anterior | PR41, cliente, runtime y SQL035 integrados |
| Visual Planning (`01a139dd…`) | Guardar el esquema exacto y depurar contradicciones | Referencia canónica y registros documentales; no requiere ejecutable nuevo |
| Conver Core (`01a139fd…`) | Dos herramientas, preparación/etiquetado y validación; pedir completar activación | PR42 y correcciones posteriores presentes; activación no completada |
| Model Core 2 (`01a13abf…`) | Producción y distribución del modelo medido | PR45/46, TestFlight117 y conservación posterior en 119 |
| CORE (`01a13af0…`) | Quitar canales/widgets/controles/integraciones/wellness; conservar optimizaciones; integrar y compilar | PR43/47, árbol nativo idéntico; retirada remota incompleta |
| iOS Only (`01a13b26…`) | Producto exclusivamente iOS/Watch y depuración de plataforma retirada | PR44 incorporada mediante PR47; no se ha desarrollado ni validado la plataforma retirada |
| Conver Core 2 (`01a13b29…`) | Completar activación; después desplegar y subir todas las mejoras como 119 | PR48/49, paquetes, despliegue real, archivo, firma y subida; tres gates siguen OFF |
| English (`01a1344f…`) | Inglés como único idioma en la ficha de App Store | Caso Apple102996183276; pendiente al cierre de ayer, independiente de la compilación 119 |

La conversación Conver Core se leyó también con su página de turnos anteriores. Los rollouts iniciales y los posteriores a compactación se incluyeron. English se incluyó aunque empezó el 13 de octubre. La extracción local y sus hashes están en `tmp/audit119/conversation-inventory.json` y en los once archivos de conversación de ese directorio.

## Qué llegó y qué está funcionando

“Publicado” significa presencia verificable en producción; no acredita ejecución correcta en un iPhone. “Compilado” significa inclusión en el archivo inspeccionado; no acredita funcionamiento físico.

| Cambio solicitado | Código e integración | Compilación/publicación | Estado operativo demostrado |
|---|---|---|---|
| Acceso sin Watch con Sample sleep y recuperación del setup | `0850cf3` conservado en la integración | SetupView y cliente compilados en 119; CI de setup/interfaz | Pruebas automáticas correctas; no prueba nueva autenticada en el iPhone de Guillem |
| Descanso medido como objetivo y procedencia Watch | PR41 integrada | Runtime en los paquetes nuevos y cliente 119 | Preparado; sin noches medidas registradas en las nuevas tablas |
| Health contextual con consentimiento y revocación | Incluido en cliente/runtime/035 | Compilado y publicado | Pruebas de software; permisos y sincronización físicos pendientes |
| Uso digital mediante API elegible de Apple | Incluido en `RestHealthContext.swift`, donde se declara `RestDigitalContext` | Archivo Swift compilado en 119 | Depende de disponibilidad y autorización del dispositivo; no demostrado físicamente |
| Contexto persistente medido, baseline y experimentos | `bmb-rest.js` y SQL035 | Presente en paquetes; tablas/RPC de producción | Cero contextos nuevos, noches, experimentos y ejecuciones verificadas en esas tablas |
| Revisión autónoma diaria | Runtime conservado y cron configurado | `bmb-tick` publicado con `*/5 * * * *` | Programación confirmada; no ciclo real de mejora de descanso acreditado |
| Pool global por consentimiento | Implementación y RPC conservadas | Runtime/SQL publicados | Sin resultados medidos en las nuevas tablas; no aprendizaje/eficacia real certificados |
| Nueva arquitectura `consultar_contexto` / `gestionar` | Integrada desde PR42 y correcciones finales de PR48 | Código incluido en los paquetes publicados | **OFF** por `bm-agent-activation.json`; se mantiene la vía anterior |
| Preparación ampliada de consultas por Decisions | Código y clasificador bilingüe integrados | Paquetes publicados | **OFF**; distinta de la recuperación acotada anterior, que sigue habilitada |
| Etiquetado nuevo de memoria | Código y SQL036 integrados | Tablas/RPC presentes y protegidas | **OFF**, cero etiquetas; no acredita retirada de una generación ni ahorro |
| Memoria/acciones por las rutas existentes | Conservadas con identidad, parámetros y recibos | Cliente y backend publicados | Pruebas automáticas; no se han ejecutado acciones físicas nuevas en esta auditoría |
| Voz ElevenLabs y texto progresivo | Conservados | Paquete de voz/stream publicado | Configuración ON/ElevenLabs; no prueba nueva de reproducción o latencia física |
| Retirar widget | Target, fuentes y recursos retirados | No hay extensión Widget en el archivo119 | Confirmado por inspección del paquete y prueba posterior del usuario |
| Retirar NFC y controles secundarios visibles | Limpieza CORE incorporada | Cliente CORE compilado | Retirada de UI; persisten tipos/identificadores o mecanismos compartidos que no prueban una pantalla activa |
| Retirar WhatsApp/SMS | Fuera del cliente y de la fuente vigente | **Endpoints antiguos siguen publicados** | Retirada productiva incompleta; no se han enviado mensajes para probarlos |
| Retirar integraciones y wellness amplio | Fuente e informes nativos depurados | Cliente compilado; **funciones antiguas del servidor conservadas** | Limpieza productiva incompleta |
| Exclusividad iOS/Watch | PR44 incorporada en PR47 | Cliente final preservado | Dirección vigente; sin reintegración de la plataforma retirada |
| Limpieza web local mencionada en iOS Only | Registrada como local | Release119 preservó los 17 estáticos productivos | No acreditar publicación de esa limpieza con esta build |
| Idioma único de la ficha de App Store | Gestión externa de metadata | No depende del binario119 | Pendiente de Apple al cierre del 14 de octubre; sin nueva gestión del caso en esta auditoría |

El catálogo conversacional discutido incluía posibilidades futuras. Terminar/ampliar una sesión, omitir una ocurrencia o alternar una ventana concreta no se deben presentar como comandos nuevos implementados: el cierre conserva 15 comandos nativos y documenta esos límites. El diseño aprobado no es una prueba de disponibilidad de todas las acciones imaginadas durante la conversación.

## Prueba de compilación y distribución

| Evidencia | Resultado |
|---|---|
| Fuente del archive | `aa4f288784fcef0a99895d6f4be148bf302e84ee` |
| CI de distribución | [38612525280](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38612525280), success; `ARCHIVE SUCCEEDED`, Xcode26.4 |
| Archivo local conservado | SHA256 `e75d8c7a3119994c8340713c5c7874d4041e0615a8ca60b186856dd3e0146eb0` |
| Comprobación independiente de archivo | 18/18 hashes correctos, cero archivos inesperados, plist1.9/119 y URL productiva, QA cookie vacía |
| Extensiones incluidas | BlankDeviceActivityMonitor, BlankShieldConfiguration, BlankShieldAction; ninguna Widget |
| Nativo probado frente al compilado | Árbol `bbfd5ebb…` idéntico en CORE32fa44c, UI02f02e1, archiveaa4f288 y checkout actual |
| CI de interfaz del árbol exacto | [38602613402](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38602613402), success |
| Compilación de fuentes relevantes | Logs incluyen BlankBrain, RestHealthContext, HealthKitStore, SetupView, SessionStore, ScreenTimeBlocker, RestProgressView y AssistantAppView |
| Firma | Captura `tmp/release-today/signature119.png`: SIGNATURE_VALID1.9(119), app y tres extensiones |
| Subida | Captura `tmp/release-today/upload119.png`: Upload succeeded y EXPORT SUCCEEDED el14oct20:27:26CEST |
| Disponibilidad/instalación | Confirmación de Guillem en el chat de release y en este chat |

El archive local inspeccionado es el original sin firmar utilizado como entrada de firma; no es una descarga del IPA instalado desde Apple. La firma y subida están acreditadas por los recibos/capturas conservados y el reporte del usuario. No hay una extracción criptográfica del binario instalado en su iPhone. Esa frontera limita cualquier garantía absoluta sobre el dispositivo.

PR42 permanece abierta y PR44 está cerrada sin merge directo. Eso no prueba que falte su implementación: PR47 contiene las entradas CORE/iOS y PR48 las correcciones conversacionales finales. PR49 es documental. La identidad de árboles y los paquetes publicados sustentan la inclusión, no el estado aislado de una PR.

## Comprobación directa de producción el 15 de octubre

Consultas autenticadas a la API de Netlify y consultas SQL dentro de transacción READ ONLY. Sin despliegue, mutación de flags, datos personales leídos, envíos externos, identidades de prueba nuevas ni llamadas a modelos/voz.

El deploy publicado sigue siendo `6acfc61acb76af6afeb41145`. Sus 78 digests coinciden con el manifiesto. Los ocho ZIP nuevos coinciden byte a byte con el paquete, manifiesto y digest remoto. Sus 58 inputs de construcción coinciden con los archivos actuales; los 67 inputs del fingerprint del runtime también coinciden. Se inspeccionaron módulos de descanso y herramientas dentro de los paquetes de aplicación/dispositivo/worker.

Entorno productivo con el mismo digest que el preflight de ayer; cron sin cambios, voz habilitada/ElevenLabs y recuperación acotada anterior habilitada. Las tres activaciones nuevas siguen false. Los cuatro probes de autenticación de app/dispositivo/voz/stream pasan; solo prueban rechazo de acceso anónimo, no una conversación autenticada.

SQL035 y036 figuran instaladas. Las seis tablas nuevas tienen RLS y carecen de SELECT para anon/authenticated. Las consultas agregadas devuelven cero contextos sincronizados del nuevo modelo, noches medidas, noches Watch completas, experimentos, intervalos de protección y etiquetas. No se puede inferir de esos ceros que la sincronización esté rota: Guillem no tiene Watch y no hay experimento real aportado. Sí impiden afirmar eficacia, aprendizaje global o ejecución del ciclo completo en producción. Estos ceros no significan que toda la memoria histórica del producto esté vacía.

## Discrepancia de retirada productiva

El test `tools/core_launch_test.js` exige la ausencia de doce nombres retirados. Los doce faltan de la fuente y, simultáneamente, los doce siguen publicados: whatsapp-agent, sms-agent, assistant-channel, assistant-action-retry-background, waitlist-agent, wearable-oauth-start, wearable-oauth-callback, wearable-sync, weather-context, wellness-signal, digital-wellness-features y blanked-agent.

El inventario también contiene otros archivos ausentes de la fuente vigente: 51 entradas en total, incluidos helpers y servicios históricos. Esa cifra no representa 51 funciones necesariamente invocadas ni 51 fallos independientes. La discrepancia suficiente y explícita son los doce nombres de retirada del propio contrato CORE.

Causa localizada: `tmp/release-today/publish.js`, línea17, construye `body.functions` copiando todo el inventario previo; después sustituye o añade ocho paquetes, sin excluir las funciones retiradas. Por eso el manifiesto preserva 70 paquetes antiguos, varios relacionados directamente con las capacidades eliminadas. La afirmación de que esos70 son todos “ajenos” a la limpieza no es correcta.

Corrección pendiente: preparar un manifiesto explícito de retirada y dependencias, conservar servicios vigentes/cuentas/datos/rollback y verificar después la ausencia remota de cada función retirada. No requiere por sí sola otra compilación iOS. Esta auditoría no ha hecho ese despliegue ni cambiado la producción observada.

## Discrepancia de activación y límites

La orden de completar lo que seguía sin activarse está en Conver Core y se trasladó a Conver Core2. No quedó completada: `tools`, `retrieval` y `labels` continúan false. El gate tools condiciona la ruta de las dos herramientas en `bmb-brain.js`; por tanto, la nueva arquitectura no se vuelve operativa por estar empaquetada.

El recibo final conserva pilotos8pares tools y10pares consultas, falta de certificado200 del runtime final, audio/coste completo, pruebas físicas y beneficio no acreditado para tools. Labels no retira trabajo generativo y la recuperación de referencias aún requiere extracción de parámetros. No es solo una espera por disponibilidad del iPhone: queda trabajo de validación/implementación. Forzar ON no resolvería esas carencias. Se mantiene el techo final40USD y sus reservas; auditoría con gasto de proveedor cero.

## Cierre

La concurrencia de conversaciones no dejó fuera el cliente nativo integrado identificado. Sí hubo un error en la composición del despliegue remoto y objetivos de activación pendientes. El anterior43/43 no detectaba la permanencia de endpoints retirados en el servidor: comprobaba fuente y contratos, no ese inventario productivo. Los78hashes correctos certifican coincidencia con el manifiesto; no certifican que el manifiesto cumpla toda la retirada pedida.

Evidencias nuevas: `tmp/audit119/artifact-verification.json`, `live.json`, `schema-live.json`, `probes.json`, `github.json`, inventario y registros de conversaciones. Baseline propia: `tmp/product-harness/audit119-baseline.json`. Validación de cierre: `tmp/product-harness/audit119-final.json`.

Garantía que sí permite esta auditoría: procedencia e integridad de la119 y de los ocho paquetes nuevos, widget retirado, discrepancia remota demostrada, gates OFF y ausencia actual de evidencia medida. Garantía que no permite: todas las capacidades solicitadas activas, acciones/permisos/voz físicamente correctos o mejora del descanso demostrada.
