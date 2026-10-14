# Entrega BM semántico — 2026-09-15

## Rama y alcance

Backend: `codex/bm-semantic-audit`, base `a222a4a`. El commit de entrega se identifica con `git log -1` en esta rama. Incluye backend, pruebas, documentación, una migración nueva **no aplicada** y cambios de transporte/persistencia en iOS. No es una rama de release y no se ha desplegado.

Web: repo separado `C:\Users\Guillem\Desktop\Blanked\blanked-landing`, rama `codex/bm-semantic-audit`, commit `f93e83e`. Solo cambia `app/chat/conversation.tsx`: conserva texto y estado canónicos. Los archivos preexistentes sin seguimiento no forman parte del commit. Sin publicación Sites.

## Archivos principales

- `netlify/functions/bm-semantic-state.js`, `bm-semantic-extraction.js` y `blanked-agent.js`: extracción, validación, reducer, decisión, texto y acciones.
- `_bm_semantic_store.js`, `_assistant_channel.js`, `whatsapp-agent.js`, `sms-agent.js` y `_bm_action_link.js`: estado durable, conflictos de versión, reintentos, enlaces de revisión y caché vinculada a la propuesta.
- `tools/bm_semantic_oracle.js`, `bm_semantic_replay.js`, tests y `tools/datasets/`: evaluación independiente, replay, mutaciones, conjuntos reservados y texto observado anonimizado.
- `ios/Blank/Blank/ContentView.swift`: transporte de estado, persistencia con TTL y fallo remoto sin acciones. No se ha compilado en Windows.
- Informes: [auditoría](BM_SEMANTIC_AUDIT.md), [evaluación](BM_EVALUATION.md), [evidencia](BM_EVALUATION_EVIDENCE.json), [canales](BM_CHANNEL_AUDIT.md), [adjudicación legacy](BM_LEGACY_GATE_ADJUDICATION.md).

## Requisitos antes de integrar/publicar

1. Revisar los fallos y límites del informe final; un harness verde no es aceptación semántica ni ejecución física.
2. Validar en PostgreSQL la migración `015_assistant_semantic_conversations.sql`, después de la 014. Verificar permisos de `service_role`, CAS concurrente, TTL y liberación del lease de reintento. Este trabajo solo ha ejecutado mocks y revisión estática del SQL.
3. Configurar `BM_SEMANTIC_PERSISTENCE=required` después de preparar la tabla/RPC y antes de publicar el backend. Producción/Netlify ya exigen persistencia por defecto. `legacy` existe para compatibilidad local y no satisface los criterios de release. Sin migración, el modo requerido falla cerrado.
4. Comprobar `OPENAI_MODEL` y `OPENAI_API_KEY` de la futura release. El valor por defecto y ejemplo es `gpt-5.6-luna`; las pruebas activas locales verifican el modelo devuelto. No se imprimen ni versionan credenciales.
5. Compilar el cliente iOS y probar revisión, permisos, selección exacta y ejecución física en app/WhatsApp/SMS. Integrar y desplegar únicamente en la tarea de release tras petición explícita.

## Reproducción local

```powershell
node tools/product_harness.js --contract tools/product_harness_contract.json --baseline tmp/product-harness/baseline.json --mode validate --enforce-scope --report tmp/bm-audit/final-harness.json
node tools/bm_semantic_oracle_test.js --out tmp/bm-semantic/oracle-mutations.json
node tools/bm_legacy_evaluator_audit.js --out tmp/bm-semantic/legacy-false-positives.json
```

La baseline original se creó antes de editar; no regenerarla para ocultar alcance. En otra copia se debe crear una baseline sobre la base de integración antes de aplicar la rama. Comandos de replay activo, diferencial y batch en `BM_EVALUATION.md`. Los informes extensos permanecen en `tmp/`; las cifras, hashes y evidencia seleccionada quedan en documentación versionada.
