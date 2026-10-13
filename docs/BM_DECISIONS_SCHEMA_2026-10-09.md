# Integración de esquema antes de ON

Estado: preparada, no aplicada. Producción sigue OFF. El preflight guardado usa `limit=0` y no lee datos personales: `assistant_app_turns` y `blankmind_identity_links` existen; las tablas de memoria y BMB necesarias devolvieron404.

Orden de las migraciones existentes: `026_blankmind_brain_memory.sql` → `027_bmb_autonomy.sql` → `028_bmb_longitudinal.sql`.

Dependencias previas que deben comprobarse en el catálogo antes de aplicar: `auth.users`, `assistant_app_turns`, `assistant_semantic_conversations` (incluido `storage_version`), `digital_wellness_feature_payloads`, funciones `digest`/`gen_random_uuid` de pgcrypto. `028` reemplaza `commit_assistant_brain_memory` y el worker de revisión diaria creados previamente; no puede aplicarse aisladamente.

Las migraciones incorporan RLS, acceso de service_role, evidencia de memoria, borrado durable, captura de observaciones y RPCs de acciones con autoridad acotada. El test PostgreSQL de CI37952689732 pasa con las migraciones del repositorio. Esto verifica un esquema desechable; no certifica el catálogo actual de producción.

Antes de la mutación, guardar catálogo de tablas/columnas/RPCs/triggers y el historial real de migraciones. No ejecutar `db push` global ni reparar el historial020 existente: la instalación de producción conserva una migración020 con nombre distinto. `027` y `028` crean objetos sin `IF NOT EXISTS`; una ejecución parcial debe reconciliarse objeto por objeto, sin borrar datos ni repetir a ciegas.

Aplicar únicamente la integración necesaria después de superar calidad, revisión humana y evidencia física exacta. Usar el control de release existente, sin modificar sus mínimos. Comprobar después las columnas/RPCs, privilegios service_role, rechazo anon/authenticated y smoke con identidades sintéticas propias; conservar recibos de ejecución y eliminar únicamente esas identidades.

No incluir029–030 de Jev ni031–033 de voz en esta tarea. Antes de publicar bundles, preservar las funciones ajenas y la configuración de voz existente. Jev permanece OFF.

Rollback: flag global OFF y republicar el paquete compatible; mantener el esquema aditivo y sus datos. No ejecutar DOWN ni borrar tablas.
