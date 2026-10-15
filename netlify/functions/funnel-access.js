"use strict";
const {supabaseFetch,json}=require("./_membership");
const catalog=require("./funnel-catalog.json");
const path=(table,user)=>`${table}?auth_user_id=eq.${encodeURIComponent(user)}`;
async function state(user,db=supabaseFetch){
 const rows=await db(`${path("funnel_accounts",user)}&select=*`,{method:"GET"});
 return rows[0]||{auth_user_id:user,initial_implemented_at:null,first_completed_at:null};
}
async function premium(user,db=supabaseFetch,now=Date.now()){
 const rows=await db(`${path("funnel_storekit_grants",user)}&select=*`,{method:"GET"});
 const grant=rows[0];
 if(!grant||!Number.isFinite(Date.parse(grant.expires_at))||!Number.isFinite(Date.parse(grant.checked_at))||Date.parse(grant.checked_at)>now+30000)return false;
 if(now-Date.parse(grant.checked_at)>300000||Date.parse(grant.expires_at)<=now){
   try{return (await require("./funnel-storekit").refresh(user,grant.transaction_id,{db})).premium===true;}catch(_){return false;}
 }
 return Date.parse(grant.checked_at)<=now+30000 && Number.isFinite(Date.parse(grant.checked_at));
}
async function access(user,db=supabaseFetch){
 const [account,paid]=await Promise.all([state(user,db),premium(user,db)]);
 return {premium:paid,initial_setup:!account.initial_implemented_at,first_completed_at:account.first_completed_at||null,
  free_window_id:account.free_window_id||null,initial_implemented_at:account.initial_implemented_at||null};
}
async function requireFeature(user,feature,db=supabaseFetch){
 const rights=await access(user,db);
 if(rights.premium||(feature==="conversation"&&rights.initial_setup))return null;
 return json(402,{error:"personalized_followup_required",feature,free_plan_preserved:true});
}
function actionAllowed(action,rights,windows=[]){
 if(!action)return true;
 if(rights.premium)return true;
 if(action.autonomous)return false;
 if(["pause_rules","disable_pause","delete_schedule","delete_all_schedules","disable_daily_limit","disable_allow_only","disable_adult_filter","request_screen_time_permission","open_app_picker"].includes(action.type))return true;
 if(action.type==="update_schedule")return Boolean(rights.free_window_id)&&action.window_id?.toLowerCase()===rights.free_window_id.toLowerCase()
  ||rights.initial_setup===true&&windows.length===1&&typeof windows[0].id==="string"&&action.window_id?.toLowerCase()===windows[0].id.toLowerCase();
 if(action.type==="apply_schedule")return (Boolean(rights.free_window_id)&&action.id?.slice(4).toLowerCase()===rights.free_window_id.toLowerCase()
  ||(!windows.length&&rights.initial_setup))&&action.recurrence==="continuous";
 // Selection during the first configuration must remain free.
 if(action.type==="configure_and_open_app_picker")return rights.initial_setup&&windows.length===0;
 return false;
}
async function api(auth,body,db=supabaseFetch){
 const user=auth.user.id;
 if(body.action==="funnel_status")return json(200,{ok:true,...await access(user,db),catalog:{
  sales_approved:catalog.sales_approved,product_ids:catalog.sales_approved?catalog.product_ids:[],
  entitlement_ids:[...new Set([...catalog.product_ids,...catalog.existing_entitlement_ids])]}});
 if(body.action==="funnel_verify"){
  const result=await require("./funnel-storekit").verify(user,body.signed_transaction,{db});
  return json(200,{ok:true,...result});
 }
 if(body.action==="funnel_claim")return require("./funnel-diagnosis").claim(auth,body,db);
 if(body.action==="funnel_receipt"){
  const r=body.receipt;
  if(!r||!/^[-0-9a-f]{36}$/i.test(r.window_id||"")||r.registered!==true||r.screen_time_authorized!==true||r.selection_count<1
    ||!Number.isSafeInteger(r.selection_count)||r.selection_count>10000||!Number.isInteger(r.window_count)||r.window_count<1
    ||(r.replaces_window_id!=null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.replaces_window_id))
    ||!Number.isInteger(r.start_minute)||r.start_minute<0||r.start_minute>1439||!Number.isInteger(r.end_minute)||r.end_minute<0||r.end_minute>1439
    ||r.start_minute===r.end_minute||r.permanent!==true||!Array.isArray(r.weekdays)||!r.weekdays.length||r.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))return json(400,{error:"invalid_native_schedule_receipt"});
  // Native registration is evidence of scheduling, never evidence of a completed block or better sleep.
  await db("rpc/funnel_implement_first",{method:"POST",body:JSON.stringify({p_user:user,p_window:r.window_id,p_receipt:r})});
  return json(200,{ok:true,...await access(user,db)});
 }
 return null;
}
module.exports={state,premium,access,requireFeature,actionAllowed,api};
