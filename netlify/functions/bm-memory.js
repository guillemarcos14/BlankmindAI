"use strict";
// Account-scoped declarations; BMB is the only conversational/decision authority.
const {supabaseFetch}=require("./_membership");
const KEYS=["name","goal","work_routine","bedtime","weak_moments","preferences","constraints"];
async function readMemories(userId) {
  const rows = await supabaseFetch(`bm_brain_memories?auth_user_id=eq.${encodeURIComponent(userId)}&select=key,value,source_text,source_turn_id,source_at,updated_at&order=updated_at.desc&limit=8`, { method: "GET" });
  return rows.filter(row => [...KEYS,"_reset"].includes(row.key)).map(row => ({ key: row.key, value: row.value,
    source: "user_statement", source_text: row.source_text, source_turn_id: row.source_turn_id,
    source_at: row.source_at, updated_at: row.updated_at }));
}

async function commitMemory(userId, turnId) {
  const result = await supabaseFetch("rpc/commit_assistant_brain_memory", {
    method: "POST", body: JSON.stringify({ p_auth_user_id: userId, p_turn_id: turnId }) });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.committed) throw new Error("brain_memory_commit_failed");
}

module.exports={KEYS,readMemories,commitMemory};

