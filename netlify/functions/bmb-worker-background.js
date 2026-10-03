"use strict";
const crypto=require("node:crypto");
const {supabaseFetch}=require("./_membership");
function signature(body){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error("bmb_worker_key_missing");return crypto.createHmac("sha256",key).update(body).digest("hex");}
async function dispatch(){
  const base=process.env.URL;
  if(!base||new URL(base).protocol!=="https:")throw Error("bmb_worker_origin_missing");
  const body=JSON.stringify({expires:Date.now()+5*60000,nonce:crypto.randomUUID()});
  const result=await fetch(new URL("/.netlify/functions/bmb-worker-background",base),{method:"POST",headers:{"content-type":"application/json","x-bmb-signature":signature(body)},body,signal:AbortSignal.timeout(8000)});
  if(result.status!==202)throw Error("bmb_worker_dispatch_failed");
  return {accepted:true};
}
exports.handler=async event=>{
  const supplied=event.headers?.["x-bmb-signature"]||"";
  const expected=signature(event.body||"");
  let body;try{body=JSON.parse(event.body);}catch(_){return {statusCode:403};}
  if(event.httpMethod!=="POST"||supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))||body.expires<Date.now()||body.expires>Date.now()+6*60000)return {statusCode:403};
  const deadline=Date.now()+12*60000;
  while(Date.now()<deadline){
    const result=await supabaseFetch("rpc/bmb_claim_due_account",{method:"POST",body:"{}"});
    const account=Array.isArray(result)?result[0]:result;
    if(!account?.auth_user_id)return {statusCode:200};
    try{await require("./bmb-service").tickAccount(account);}catch(error){
      console.error(JSON.stringify({event:"bmb_tick_failed",code:/^bmb_[a-z_]+$/.test(error.message)?error.message:"dependency_error"}));
    }
  }
  await dispatch();return {statusCode:200};
};
module.exports.dispatch=dispatch;
