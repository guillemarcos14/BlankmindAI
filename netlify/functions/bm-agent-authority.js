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
module.exports={textOnly,hasEffects};
