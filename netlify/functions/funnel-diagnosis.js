"use strict";
const crypto=require("node:crypto");
const {supabaseFetch,json,parseJsonBody}=require("./_membership");
const digest=s=>crypto.createHash("sha256").update(s).digest("hex");
function normalize(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const clean=s=>typeof s==="string"?s.trim().slice(0,1600):"";
 const context={routine:clean(value.routine),difficulty:clean(value.difficulty),apps:clean(value.apps),
  start_minute:value.start_minute,end_minute:value.end_minute,source:"user_declared_web_diagnosis",hypothesis:true};
 if(!context.routine||!context.difficulty||!Number.isInteger(context.start_minute)||context.start_minute<0||context.start_minute>1439
  ||!Number.isInteger(context.end_minute)||context.end_minute<0||context.end_minute>1439||context.start_minute===context.end_minute)return null;
 return context;
}
async function claim(auth,body,db=supabaseFetch){
 if(!/^[a-f0-9]{64}$/.test(body.token||""))return json(400,{error:"invalid_diagnosis_code"});
 const data=await db("rpc/funnel_claim_diagnosis",{method:"POST",body:JSON.stringify({p_user:auth.user.id,p_hash:digest(body.token)})});
 const context=Array.isArray(data)?data[0]:data;
 if(!context)return json(410,{error:"diagnosis_expired_or_claimed"});
 await db("funnel_accounts?on_conflict=auth_user_id",{method:"POST",headers:{prefer:"resolution=merge-duplicates"},
  body:JSON.stringify({auth_user_id:auth.user.id,diagnosis:context})});
 return json(200,{ok:true,diagnosis:context});
}
async function handler(event){
 if(event.httpMethod==="OPTIONS")return json(204,{});
 if(event.httpMethod!=="POST")return json(405,{error:"method_not_allowed"});
 if(Buffer.byteLength(event.body||"")>9000)return json(413,{error:"diagnosis_too_large"});
 try{
  const body=parseJsonBody(event),context=normalize(body.context);
  if(body.consent!==true||!context)return json(400,{error:"diagnosis_and_consent_required"});
  const token=crypto.randomBytes(32).toString("hex");
  // Database TTL and one-time account binding; token is never a premium entitlement.
  await supabaseFetch("funnel_diagnoses",{method:"POST",body:JSON.stringify({token_hash:digest(token),context})});
  return json(200,{ok:true,token,expires_in:86400});
 }catch(_){return json(503,{error:"diagnosis_transfer_unavailable"});}
}
exports.handler=handler;Object.assign(exports,{normalize,claim,digest});
