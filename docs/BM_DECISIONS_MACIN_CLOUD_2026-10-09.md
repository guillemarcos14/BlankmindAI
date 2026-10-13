# Preparación de build física exacta

Bloqueo observado: inventario de navegador del 9 de octubre, sin pestaña MacinCloud. No se ha compilado ni distribuido una build nueva en esta conversación.

Fuente exacta evaluada: `e21affb8db35237f31836deda998616e41b0d28b`, disponible en origin `codex/backend-release-decisions-production-2026-10-09`. CI37954718650 pasa contrato/runtime, PostgreSQL y Android. `git diff a96e699 HEAD -- ios` no muestra cambios nativos; eso no sustituye la identidad de una build ni sus pruebas físicas.

Referencia Mac probada: FF368, repo `/Users/user301201/blankmind-bmb-qa`; configuración privada conservada `/Users/user301201/blank-testflight-105/qa107.xcconfig`; proyecto `ios/Blank/Blank.xcodeproj`, scheme `Blank`, destino `generic/platform=iOS`.

Cuando esté disponible la Terminal, comprobar primero ruta, árbol limpio, origen y perfiles. Crear un checkout aislado del commit exacto y una nueva configuración privada con `umask077`, reutilizando el perfil conservado sin reconstruir secretos. Elegir número de build libre tras consultar los archives;111 es candidato, no número asignado ni confirmado. No sobrescribir archives anteriores.

Los comandos deben introducirse carácter a carácter mediante teclado. No pegar, no `typeText` ni eventos DOM. Compilar con `xcodebuild archive`; verificar `ARCHIVE SUCCEEDED`, versión/build, endpoint privado, perfil Health Records y firma deep/strict. Conservar log, commit real y SHA-256 del artefacto descargado al repositorio.

Apple Review/publicación y operaciones Xcode quedan excluidas sin instrucción posterior explícita. El archive110 anterior no está subido según la evidencia conservada; su bloqueo Apple Accounts sigue sin comprobarse de nuevo. Una firma o compilación correcta nunca acredita distribución, instalación ni ejecución en el iPhone.

Backend exacto para prueba: QA privado `6ac90f581e087bc4cbbf0730`, Decisions ON, Jev OFF, autenticación real comprobada. Protocolo de20casos en `PHYSICAL_EXACT_E21.md`.
