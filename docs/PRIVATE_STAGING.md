# Verificación privada de Backend Cloud

La autorización explícita de Guillem del 26/09/2026 permite a esta tarea asumir integración y despliegue. La exposición de una release a usuarios sigue dependiendo de sus gates. La verificación previa se hace en infraestructura separada, sin copiar datos de producción.

Staging confirmado el 26/09 a las 17:12:36 UTC: runtime `105cf120761594b75d5a0b47656ea903e4abac2f`, integración `30311fe5bae90df21453d506aed834acceb8c6c8`, deploy `6ab7fc6184f6d6492d619bb7`. Cuatro ZIP remotos verificados, 37 inputs coincidentes, acceso anónimo HTTP 401 en página y función. Harness integrado 63/63 con scope; smoke cloud 9/9 y limpieza 12/12. Preflight separada: Luna activa, un intento, sin error. El smoke no acredita inferencia individual ni recibos físicos. El juez de 105 terminó a las 17:24:39 UTC: 925 dictámenes, 100 % de calidad visible y cero hallazgos graves; persisten 29 errores operativos y cinco flags léxicos (33 turnos fallidos originales), por lo que no cumple release. El candidato 66 permanece histórico rechazado. Producción y distribución permanecen intactas. Índice: [PRODUCT_NEXT_EVIDENCE.json](PRODUCT_NEXT_EVIDENCE.json).

La rama remota `codex/backend-release-candidate-canonical-2026-09-26` está verificada en el SHA exacto `105cf120761594b75d5a0b47656ea903e4abac2f`; evidencia `Codigo-product-release/tmp/cloud-stage/candidate-anchor-105cf12.json`. La rama anterior `codex/backend-release-candidate-2026-09-26` conserva 66 como candidato histórico rechazado. La integración `30311fe5bae90df21453d506aed834acceb8c6c8` comparte el árbol completo `81e338e3d107257c5ec86a5198ef942ce6bab306` con 105; eso no convierte sus SHA en intercambiables para el gate. Los commits posteriores de documentación permanecen fuera del anchor evaluado. El gate sigue exigiendo el mismo commit en modelo, build firmada, evidencia física y `--head`; el anchor no es una aprobación de release.

## Entorno reservado

- Supabase: `blank-product-staging`, referencia `njqbovsmoowkhhsqmitn`, misma organización y plan Free, región `eu-west-3`.
- Netlify: `blank-product-staging-20260926`, site `2ef5a74e-af70-4893-a5f6-63fb2537720d`, [sitio privado](https://blank-product-staging-20260926.netlify.app).
- Producción permanece en Supabase `vhiikgyyfisejjwqtxfc` y Netlify `59955668-9a9b-4979-a283-63fbf3115fe5`. Ningún comando de staging puede usar esos IDs como destino.

La API de branches respondió `402 entitlement_required`: exige Pro. Se creó un segundo proyecto independiente dentro de la cuota Free, sin cambiar la suscripción. [Límites del plan](https://supabase.com/docs/guides/platform/billing-faq). El proyecto nuevo solo contiene fixtures sintéticos cuando se ejecutan los smokes.

El sitio exige contraseña: comprobación HTTP anónima `401`; sesión autorizada `200`. Netlify utiliza un formulario de contraseña que entrega una cookie; Basic Auth no autentica esta protección. La cookie va en un encabezado independiente y permite conservar el JWT de Supabase en `Authorization`.

Credenciales y cookie se guardan cifradas con DPAPI en `tmp/cloud-stage/*.dpapi` del worktree de implementación. No imprimirlas, incluirlas en informes ni añadirlas a Git. Las variables Netlify pertenecen únicamente al sitio de staging: URL y claves de su propia base, OpenAI y routing público desactivado. No se copian Twilio, Meta ni APNs. No se despliegan cron ni transportes de mensajería en esta verificación.

## Secuencia

1. Congelar, integrar y validar el candidato en `codex/backend-release-*`; mantener su baseline y ejecutar `--enforce-scope`.
2. Ejecutar `supabase db push --project-ref njqbovsmoowkhhsqmitn --dry-run` con la contraseña privada. Revisar las migraciones y aplicarlas exclusivamente al proyecto de staging. No usar el setup SQL de pruebas sobre una base de Supabase.
3. Publicar en el sitio de staging solo las entradas de app/autenticación/planner necesarias, empaquetadas desde el candidato validado. Comprobar protección anónima, JWT, aislamiento entre dos cuentas y recuperación real contra PostgreSQL.
4. Registrar commit, deploy, funciones/digests, versiones SQL y resultado de los smokes. Un acuse enviado por una prueba de API se etiqueta como simulado y no cuenta como Screen Time físico.
5. Para la prueba en iPhone, compilar una build firmada con `BLANK_MEMBERSHIP_API_BASE_URL` apuntando al entorno de QA y preparar su acceso privado; conservar hash de artifact y trazas. El gate productivo exige su evidencia física y revisión de modelo. Tras publicar en producción se repiten los smokes y se registra el nuevo deploy; no atribuir a ese entorno pruebas realizadas solamente en staging.

La matriz SQL completa en staging comprueba instalaciones nuevas. La auditoría de producción confirmó por REST la existencia de las dos columnas SMS de `020` y de `bm_legacy_context_snapshots`; `assistant_app_turns` sigue ausente. El nombre histórico distinto de `020` no autoriza reescribir su historial. `022`–`024` son aditivas.

## Empaquetado reproducible

Desde el worktree candidato:

```powershell
node tools/backend_staging.js --dry-run
```

El comando predeterminado solo trabaja en local. Genera wrappers que importan los handlers del worktree, empaqueta sus dependencias con `esbuild` y conserva exactamente cuatro ZIP: `app-auth`, `assistant-app`, `assistant-channel` y `blanked-agent`. Registra SHA de Git, limpieza del árbol, hashes de las fuentes transitivas y de los ZIP en `tmp/cloud-stage/package-*.json`. Un paquete de un árbol modificado queda marcado como no desplegable. Las credenciales no se leen ni se incluyen en el paquete local.

Los ZIP se guardan en un directorio temporal aislado de los repositorios. Netlify CLI acepta esos ZIP y los copia sin reempaquetarlos; esto permite comparar su SHA-256 con el digest remoto. El directorio aislado evita recoger `netlify.toml`, caches, cron o funciones internas de otro proyecto. Los módulos de transporte que necesita internamente la app pueden formar parte del bundle, pero no se publican como endpoints ni se configuran sus credenciales.

Solo después de congelar y validar una rama `codex/backend-release-*` limpia:

```powershell
node tools/backend_staging.js --deploy
```

`--source <worktree>` permite seleccionar otro candidato y `--netlify-cli <run.js>` selecciona el runtime instalado. El site de destino está fijado a QA y rechaza producción. Antes de la única llamada de despliegue, el script comprueba contraseña anónima tanto en la página como en una ruta de función, URL de la base aislada, ausencia de credenciales de transporte, routing desactivado y fuente sin cambios desde el empaquetado. Las claves enmascaradas por Netlify se registran como no inspeccionadas; su validez se comprueba con el smoke autenticado. `--prod` del comando interno solo publica en el site privado de QA; no usa `--context`, incompatible con `--no-build` en este CLI.

Al terminar, compara los cuatro digests remotos, ausencia de schedules, deploy activo y protección privada. El informe solo marca `private_deploy_verified` si todo coincide. Un fallo después de solicitar el despliegue queda como resultado desconocido o desplegado sin verificar; no se reintenta automáticamente. El script no aplica SQL, no ejecuta el modelo ni sustituye las pruebas físicas o el gate de producción.

Si el proveedor publicó el candidato y falló la verificación posterior, se verifica el mismo deploy sin volver a empaquetar ni publicar:

```powershell
node tools/backend_staging.js --verify-report <ruta-al-package-report.json>
```

Esta modalidad solo realiza lecturas remotas. Exige que los cuatro ZIP originales sigan presentes y coincidan con sus hashes y tamaños; conserva el SHA de fuente, los hashes transitivos y el informe original sin modificarlo. Escribe un recibo `*.verification-*.json` ligado al hash del informe original, y comprueba de nuevo deploy activo, base aislada, privacidad, ausencia de transportes/schedules y los cuatro digests remotos. Acepta el inventario real de Netlify como objeto de grupo y el formato histórico como lista, rechazando formas desconocidas, grupos ambiguos, entradas duplicadas o hashes distintos. El runtime informado por Netlify se registra aparte del target de compilación del bundle. Ningún fallo provoca redeploy automático.

La regresión local del empaquetador se ejecuta con `node tools/backend_staging_test.js` y comprueba allowlists, ausencia de llamadas remotas por defecto, fuente limpia, privacidad, base aislada y comparación de hashes.

## Recuperación

Los fixtures de QA y sus credenciales solo pertenecen al entorno aislado. Para una futura retirada se elimina primero el acceso del sitio y después los recursos sintéticos identificados; no se toca la base productiva. Una release productiva conserva el deploy anterior como rollback y mantiene las tablas aditivas para no perder turnos. Los límites de gasto, retención y plan permanecen sujetos al proveedor; no se configuraron servicios de pago ni mantenimiento artificial para evitar pausas del plan Free.
