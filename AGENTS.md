# Gestion de estado del proyecto

## Plataforma vigente

Trabajar exclusivamente en iOS y Apple Watch. Cualquier ampliación de plataforma requiere una nueva decisión explícita de Guillem. Usar solo las validaciones y herramientas de la plataforma activa.

## Al inicio de cada sesion
1. Lee `ESTADO.md` en la raiz del repo antes de hacer nada.
2. Si no existe, crealo con la estructura definida abajo antes de empezar la tarea.
3. Trata su contenido como la fuente de verdad sobre decisiones ya tomadas:
   no propongas rediscutir decisiones marcadas como cerradas salvo que el usuario lo pida.
4. Para trabajo iOS, comprueba primero el estado de Apple Developer, Xcode/MacinCloud y provisioning anotado en `ESTADO.md` antes de cambiar codigo.

## Durante la sesion
- Si se toma una decision de arquitectura, diseno o producto, anotala en
  `ESTADO.md` -> "Decisiones" en el momento, no al final.
- Si un enfoque se prueba y se descarta, anotalo en "Descartado" con una
  linea explicando por que.
- Separa claramente tres capas de estado: compilacion local/simulador, firma/provisioning, y distribucion TestFlight/App Store.
- No presentes un build firmado o un archive como completado si solo se ha verificado `CODE_SIGNING_ALLOWED=NO`.
- No digas que TestFlight esta listo mientras `Family Controls (Distribution)` siga pendiente de aprobacion por Apple.

## Integracion Backend Cloud

- Las conversaciones de implementación trabajan en ramas `codex/...` y no despliegan producción.
- Para reunir varias ramas usa `docs/BACKEND_INTEGRATION_WORKFLOW.md` y `node tools/backend_release.js`.
- La release debe vivir en `codex/backend-release-*`, tener baseline del product harness y pasar la validación con `--enforce-scope` antes de cualquier deploy.
- Netlify/Supabase solo se mutan desde la conversación de integración y con `--confirm` explícito.

## Compilacion en MacinCloud
- Cuando el usuario pida compilar en MacinCloud, el agente debe encargarse de la Terminal por RDP web usando pulsaciones individuales, no pegado ni atajos de teclado, porque el cliente puede transformar `Cmd/Ctrl+V` en caracteres de control y perder texto.
- Secuencia esperada:
  1. Entrar en `~/BlankMVP`.
  2. Ejecutar `git pull --ff-only origin codex/ios-device-activity-target`.
  3. Entrar en `ios/Blank`.
  4. Compilar desde Terminal. Si no se pueden introducir mayusculas de forma fiable, usar `xcodebuild -project blank.xcodeproj build`, que ya valido el target `Blank` en MacinCloud. Si se puede escribir con mayusculas, preferir `xcodebuild -project Blank.xcodeproj -scheme Blank -configuration Debug build`.
  5. Confirmar explicitamente si termina con `BUILD SUCCEEDED` o copiar el primer error util si falla.
- Al terminar la parte de Terminal, dar siempre al usuario los pasos manuales de Xcode para revisar visualmente, subir version/build si hace falta, hacer `Product > Archive` y `Distribute App > App Store Connect > Upload`. El agente no debe presentar el proceso de Xcode/TestFlight como completado si solo se ha hecho build por Terminal.

## Al final de cada bloque de trabajo
Actualiza `ESTADO.md` siempre, sin que el usuario lo pida, cuando ocurra cualquiera de:
- Has completado la tarea solicitada.
- Detectas que la conversacion es larga y el contexto puede compactarse pronto.
- El usuario dice "cierra", "para aqui", "lo dejamos" o similar.

La actualizacion debe ser incremental: edita el archivo, no lo reescribas entero.
Debe reflejar que se hizo hoy, estado actual y proximos pasos concretos.

## Estructura de `ESTADO.md`
Usa esta estructura base y mantenla estable:

```md
# Estado del proyecto

Ultima actualizacion: YYYY-MM-DD

## Resumen actual
- ...

## Hecho hoy
- YYYY-MM-DD: ...

## Estado actual
- ...

## Proximos pasos concretos
- ...

## Decisiones
- [cerrada] YYYY-MM-DD: ...

## Descartado
- YYYY-MM-DD: ... porque ...

## Notas para la proxima sesion
- ...
```
