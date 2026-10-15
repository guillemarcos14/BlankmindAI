"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const F=require("../netlify/functions/funnel-access"),S=require("../netlify/functions/funnel-storekit"),D=require("../netlify/functions/funnel-diagnosis");
const user="11111111-1111-4111-8111-111111111111",now=Date.now();
let checks=0;const check=(condition,message)=>{assert(condition,message);checks++;};
const date=offset=>new Date(now+offset).toISOString();
async function main(){
 const empty=async()=>[];
 const free=await F.access(user,empty);
 check(free.initial_setup&&!free.premium,"First configuration has no payment barrier");
 check(await F.requireFeature(user,"conversation",empty)===null,"Initial conversation has no message/token quota");
 check((await F.requireFeature(user,"advanced_progress",empty)).statusCode===402,"Advanced Progress is explicitly paid before first completion");
 const implemented=async table=>table.startsWith("funnel_accounts")?[{initial_implemented_at:date(-1000),free_window_id:user}]:[];
 check((await F.requireFeature(user,"conversation",implemented)).statusCode===402,"Follow-up after implementation requires premium");
 check(!(await F.access(user,implemented)).first_completed_at,"Registered future window does not become completed");
 const paid=async table=>table.startsWith("funnel_storekit_grants")?[{checked_at:date(-1000),expires_at:date(60000)}]:[];
 check((await F.access(user,paid)).premium,"Server-authenticated paid grant authorizes follow-up");
 check(await F.requireFeature(user,"conversation",paid)===null,"Premium conversation has no quota");
 for(const grant of [{checked_at:"invalid",expires_at:date(1e5)},{checked_at:date(0),expires_at:"invalid"},{checked_at:date(60000),expires_at:date(1e5)}]){
  check(!await F.premium(user,async()=>[grant],now),"Malformed/future grants cannot authorize");
 }
 const rights={premium:false,initial_setup:true,free_window_id:null};
 check(F.actionAllowed({type:"apply_schedule",recurrence:"continuous"},rights,[]),"First permanent schedule is free");
 check(!F.actionAllowed({type:"apply_schedule",recurrence:"once"},rights,[]),"No silent conversion of a one-off into the free recurrent plan");
 check(!F.actionAllowed({type:"apply_schedule",recurrence:"continuous"},rights,[{}]),"Additional windows require paid access");
 check(!F.actionAllowed({type:"apply_schedule",recurrence:"continuous",autonomous:true},rights,[]),"Free autonomous changes are denied");
 for(const type of ["pause_rules","delete_schedule","delete_all_schedules","disable_pause","disable_daily_limit"])
  check(F.actionAllowed({type},{premium:false,initial_setup:false},[{}]),"Free safety control: "+type);
 check(F.actionAllowed({type:"update_schedule",window_id:user},{premium:false,free_window_id:user},[{}]),"Correcting the free window remains free");
 check(!F.actionAllowed({type:"update_schedule",window_id:"other"},{premium:false,free_window_id:user},[{}]),"Other-window edits require premium");
 check(F.actionAllowed({type:"update_schedule",window_id:user},rights,[{id:user}]),"An unregistered first window can be corrected during initial setup");
 check(!F.actionAllowed({type:"update_schedule",window_id:user},rights,[{id:user},{id:"other"}]),"Initial setup cannot grant edits to multiple legacy windows");
 check(F.actionAllowed({type:"apply_schedule",recurrence:"once"},{premium:true},[{}]),"Paid windows preserve requested exact scope");
 const transaction={bundleId:"com.blanknfc.app.ios",environment:"Sandbox",type:"Auto-Renewable Subscription",productId:"blanked_monthly_299",
  appAccountToken:user,expiresDate:now+60000,purchaseDate:now-1000,originalTransactionId:"123",transactionId:"124"};
 check(S.validTransaction(transaction,user,"Sandbox",now),"Valid server-verified transaction fixture");
 for(const patch of [{bundleId:"other"},{appAccountToken:"another"},{appAccountToken:null},{environment:"Production"},{expiresDate:now-1},
  {revocationDate:now-1},{isUpgraded:true},{purchaseDate:now+60000},{productId:"fake"},{type:"Consumable"}])
  check(!S.validTransaction({...transaction,...patch},user,"Sandbox",now),"Reject wrong owner/bundle/environment/revoked/expired/fake subscription");
 let appleCalls=0,written=[];
 const apple={environment:"Sandbox",verifier:{verifyAndDecodeTransaction:async signed=>{assert.equal(signed,"a.b.c");return transaction;}},
  client:{getAllSubscriptionStatuses:async id=>{appleCalls++;assert.equal(id,"123");return {data:[{lastTransactions:[{status:1,signedTransactionInfo:"a.b.c"}]}]};}}};
 const db=async(table,options)=>{written.push({table,options});return [];};
 const verified=await S.verify(user,"a.b.c",{apple,db,now});
 check(verified.premium&&appleCalls===1,"Restoration verifies current Apple subscription status, not signed payload replay alone");
 check(JSON.parse(written[0].options.body).auth_user_id===user,"Server binds paid rights to authenticated account");
 apple.client.getAllSubscriptionStatuses=async()=>({data:[{lastTransactions:[{status:5,signedTransactionInfo:"a.b.c"}]}]});
 check(!(await S.verify(user,"a.b.c",{apple,db,now})).premium,"Refunded subscription loses premium");
 check(written.at(-1).options.method==="DELETE","Revocation removes the server grant");
 await assert.rejects(()=>S.verify("another","a.b.c",{apple,db,now}),/account_mismatch/);checks++;
 await assert.rejects(()=>S.verify(user,"fake",{apple,db,now}),/invalid_storekit/);checks++;
 const catalog=require("../netlify/functions/funnel-catalog.json");
 check(catalog.sales_approved&&catalog.introductory_offers_approved,"Explicit approval enables the existing subscriptions and three-day trial");
 const status=JSON.parse((await F.api({user:{id:user}},{action:"funnel_status"},empty)).body).catalog;
 check(JSON.stringify(status.product_ids)===JSON.stringify(["blanked_monthly_299","blanked_annual_19"]),"Only the two approved existing StoreKit IDs are offered");
 check(status.product_terms.blanked_monthly_299.reference_price_eur==="2.99"&&status.product_terms.blanked_annual_19.reference_price_eur==="19.99","Approved EUR reference prices are exact");
 check(status.introductory_offers_approved&&Object.values(status.product_terms).every(t=>t.free_trial_days===3),"Client receives the real approved trial policy, not a hidden false default");
 const context={routine:"Read in bed",difficulty:"Scroll past bedtime",apps:"Feeds",start_minute:1320,end_minute:1350};
 check(D.normalize(context).hypothesis===true,"Diagnosis remains a user-declared hypothesis");
 check(D.normalize({...context,end_minute:1320})===null,"Reject empty window");
 let claims=[];
 const claimDB=async(table,options)=>{claims.push({table,options});return table.startsWith("rpc/")?context:[];};
 const response=await D.claim({user:{id:user}},{token:"a".repeat(64)},claimDB);
 check(response.statusCode===200,"Context transfer can be claimed");
 check(JSON.parse(claims[0].options.body).p_user===user,"Claim owner is authenticated, never client supplied");
 check(JSON.parse(claims[0].options.body).p_hash!=="a".repeat(64),"Continuation secrets are hashed at rest");
 check((await D.claim({user:{id:user}},{token:"a".repeat(64)},async()=>null)).statusCode===410,"Expired/already claimed handoff is rejected");
 let receipts=0;
 const receipt={window_id:user,registered:true,screen_time_authorized:true,selection_count:1,window_count:1,start_minute:1320,end_minute:1350,weekdays:[1,2,3,4,5,6,7],permanent:true};
 const receiptDB=async table=>{if(table==="rpc/funnel_implement_first")receipts++;return [];};
 for(const patch of [{registered:false},{screen_time_authorized:false},{selection_count:0},{permanent:false},{weekdays:[]},{end_minute:1320}]){
  check((await F.api({user:{id:user}},{action:"funnel_receipt",receipt:{...receipt,...patch}},receiptDB)).statusCode===400,"No implementation without a valid native registration receipt");
 }
 check(receipts===0,"Rejected registrations do not persist implementation");
 check((await F.api({user:{id:user}},{action:"funnel_receipt",receipt},receiptDB)).statusCode===200&&receipts===1,"Scheduling stores implementation only");
 // Production dependency is actually loadable; malformed signed data is rejected by Apple's verifier, before any network.
 const {SignedDataVerifier,Environment}=require("../netlify/node_modules/@apple/app-store-server-library");
 const verifier=new SignedDataVerifier([],true,Environment.SANDBOX,"com.blanknfc.app.ios");
 await assert.rejects(()=>verifier.verifyAndDecodeTransaction("eyJhbGciOiJFUzI1NiJ9.e30.AA"));checks++;
 const crypto=require("node:crypto"),anchors=require("../netlify/functions/funnel-apple-roots.json");
 check(anchors.certificates.length===2,"Both official Apple G2/G3 trust anchors ship in the bundle");
 const pins={"AppleRootCA-G2":"C2:B9:B0:42:DD:57:83:0E:7D:11:7D:AC:55:AC:8A:E1:94:07:D3:8E:41:D8:8F:32:15:BC:3A:89:04:44:A0:50","AppleRootCA-G3":"63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79"};
 for(const root of anchors.certificates){const certificate=new crypto.X509Certificate(Buffer.from(root.der_base64,"base64"));check(certificate.ca&&certificate.verify(certificate.publicKey),"Packaged anchor is a self-signed CA");check(certificate.fingerprint256===pins[root.name],"Packaged anchor matches the official Apple fingerprint");}
 const names=["FUNNEL_STOREKIT_ENVIRONMENT","CONTEXT","FUNNEL_APPLE_PRIVATE_KEY","FUNNEL_APPLE_KEY_ID","FUNNEL_APPLE_ISSUER_ID","FUNNEL_APPLE_ROOT_CERTIFICATES"],previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  Object.assign(process.env,{FUNNEL_STOREKIT_ENVIRONMENT:"Sandbox",CONTEXT:"deploy-preview",FUNNEL_APPLE_KEY_ID:"OFFLINEKEY",FUNNEL_APPLE_ISSUER_ID:user,FUNNEL_APPLE_PRIVATE_KEY:crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({type:"pkcs8",format:"pem"})});
  delete process.env.FUNNEL_APPLE_ROOT_CERTIFICATES;
  check(S.configuration().environment===Environment.SANDBOX,"Actual Apple SDK starts with packaged roots and no certificate environment variable");
  process.env.FUNNEL_APPLE_ROOT_CERTIFICATES="[]";assert.throws(()=>S.configuration(),/storekit_not_configured/);checks++;
  process.env.FUNNEL_APPLE_ROOT_CERTIFICATES="invalid";assert.throws(()=>S.configuration(),SyntaxError);checks++;
  delete process.env.FUNNEL_APPLE_ROOT_CERTIFICATES;process.env.CONTEXT="production";assert.throws(()=>S.configuration(),/storekit_sandbox_forbidden/);checks++;
 }finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
 const sql=fs.readFileSync(path.join(__dirname,"../supabase/migrations/037_monetization_funnel.sql"),"utf8");
 check(sql.includes("original_transaction_id text unique"),"A purchase cannot be linked to two accounts");
 check(sql.includes("for update")&&sql.includes("d.claimed_by<>p_user"),"Atomic cross-account diagnosis claim");
 console.log(`PASS monetization funnel: ${checks} entitlement, registration, free-control, restoration, expiry/refund, forgery and context-transfer assertions; no real purchases or paid model calls`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
