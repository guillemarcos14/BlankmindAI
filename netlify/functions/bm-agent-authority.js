"use strict";
// Closed effect authority, not a conversational router. A self-contained
// request to transform supplied text never makes that text an app command.
function textOnly(prompt){
 const text=String(prompt||"").trim();
 return /^(?:(?:please|por favor)[,\s]+)?(?:translate|traduce|traducir|repeat|repite|rewrite|reformula|proofread|corrige|quote|cita)\b/iu.test(text)
   && (text.includes(":")||/["»”']\s*[.!?]?$/u.test(text));
}
function hasEffects(r){return ["rest_experiment","rest_preferences","rest_exclusions","rest_claim"].some(k=>r[k]!=null)||r.action!=null||r.memory!=null||r.accepted_proposal!=null||r.pending_request!=null
 ||r.observations?.length||r.followup_resolution!=null||r.longitudinal_review!=null||!["respond","silent"].includes(r.decision);}
function explicitForgetAll(prompt){
 const text=String(prompt||"").normalize("NFKC").trim();
 // Deliberately narrow, whole-message authorization. Other wording stays open
 // to clarification; a quotation, category, exception or negation cannot erase
 // an account's complete memory merely by containing the word 'all'.
 return /^(?:(?:please|por favor)[,\s]+)?(?:forget\s+(?:everything(?:\s+(?:you\s+know\s+)?about\s+me)?|all\s+(?:my\s+)?(?:personal\s+)?(?:memories|memory|information|data))|(?:olvida|borra)\s+(?:todo(?:\s+lo\s+que\s+sabes\s+(?:sobre|de)\s+m[ií])?|tod[oa]s?\s+(?:mis?\s+)?(?:recuerdos|datos|informaci[oó]n|memoria)(?:\s+personales?)?))(?:[,\s]+(?:please|por favor))?[.!]?$/iu.test(text);
}
module.exports={textOnly,hasEffects,explicitForgetAll};
