"use strict";
// Disposable PostgreSQL-compatible engine only; never reads production credentials.
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),runtime=path.resolve(root,process.argv[2]||"tmp/rest-sql/node_modules/@electric-sql/pglite");
const {PGlite}=require(runtime),{pgcrypto}=require(path.join(runtime,"dist/contrib/pgcrypto.cjs"));
const files=["tools/assistant_app_database_setup.sql","supabase/migrations/003_digital_wellness_feature_payloads.sql",
 "supabase/migrations/015_assistant_semantic_conversations.sql","supabase/migrations/022_assistant_app_turns.sql",
 "supabase/migrations/023_assistant_app_recovery.sql","supabase/migrations/024_restore_bm_legacy_context_snapshots.sql",
 "supabase/migrations/026_blankmind_brain_memory.sql","tools/bmb_database_setup.sql",
 "supabase/migrations/027_bmb_autonomy.sql","supabase/migrations/028_bmb_longitudinal.sql",
 "supabase/migrations/035_bmb_measured_rest.sql","tools/bmb_rest_database_test.sql",
 "tools/bmb_longitudinal_database_test.sql","tools/bmb_database_test.sql","tools/bm_brain_database_test.sql"];
(async()=>{const db=new PGlite({extensions:{pgcrypto}});try{for(const file of files){try{await db.exec(fs.readFileSync(path.join(root,file),"utf8"));}
 catch(e){console.error("SQL failure in "+file+": "+e.message);throw e;}}console.log("Disposable SQL: measured rest migration, identity, replays, receipts, revocation, RLS and existing memory/autonomy contracts passed");}
 finally{await db.close();}})().catch(()=>{process.exitCode=1;});
