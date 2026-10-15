"use strict";
const {supabaseFetch}=require("./_membership");
const catalog=require("./funnel-catalog.json");
const bundleId="com.blanknfc.app.ios";
function configuration(){
 const {Environment,AppStoreServerAPIClient,SignedDataVerifier}=require("@apple/app-store-server-library");
 const environment=process.env.FUNNEL_STOREKIT_ENVIRONMENT==="Sandbox"?Environment.SANDBOX:Environment.PRODUCTION;
 // Sandbox never grants access on a production backend.
 if(environment===Environment.SANDBOX&&process.env.CONTEXT==="production")throw Error("storekit_sandbox_forbidden");
 // Public trust anchors ship with the frozen bundle, outside Lambda's 4KB environment limit.
 // An explicitly configured override remains fail-closed, including an empty list.
 const encodedRoots=process.env.FUNNEL_APPLE_ROOT_CERTIFICATES===undefined
  ? require("./funnel-apple-roots.json").certificates.map(c=>c.der_base64)
  : JSON.parse(process.env.FUNNEL_APPLE_ROOT_CERTIFICATES);
 const roots=encodedRoots.map(x=>Buffer.from(x,"base64"));
 if(!roots.length||!process.env.FUNNEL_APPLE_ISSUER_ID||!process.env.FUNNEL_APPLE_KEY_ID||!process.env.FUNNEL_APPLE_PRIVATE_KEY)throw Error("storekit_not_configured");
 return {
  client:new AppStoreServerAPIClient(process.env.FUNNEL_APPLE_PRIVATE_KEY,process.env.FUNNEL_APPLE_KEY_ID,process.env.FUNNEL_APPLE_ISSUER_ID,bundleId,environment),
  verifier:new SignedDataVerifier(roots,true,environment,bundleId,environment===Environment.PRODUCTION?6789519152:undefined),environment
 };
}
function validTransaction(t,user,environment,now=Date.now()){
 return Boolean(t&&t.bundleId===bundleId&&t.environment===environment&&t.type==="Auto-Renewable Subscription"
  &&[...catalog.existing_entitlement_ids,...catalog.product_ids].includes(t.productId)
  &&typeof t.appAccountToken==="string"&&t.appAccountToken.toLowerCase()===user.toLowerCase()
  &&!t.revocationDate&&!t.isUpgraded&&Number.isFinite(t.expiresDate)&&t.expiresDate>now
  &&Number.isFinite(t.purchaseDate)&&t.purchaseDate<=now+30000);
}
async function reconcile(user,transactionId,{db=supabaseFetch,apple=configuration(),now=Date.now()}={}){
 const response=await apple.client.getAllSubscriptionStatuses(transactionId);
 const active=[];
 // Query Apple's current status: replaying an old signed transaction cannot undo a refund or upgrade.
 for(const group of response.data||[])for(const entry of group.lastTransactions||[]){
  if(entry.status!==1)continue; // active only; no invented grace, trial or billing-retry access
  const t=await apple.verifier.verifyAndDecodeTransaction(entry.signedTransactionInfo);
  if(validTransaction(t,user,apple.environment,now))active.push(t);
 }
 active.sort((a,b)=>b.expiresDate-a.expiresDate);
 const t=active[0];
 if(!t){
  await db(`funnel_storekit_grants?auth_user_id=eq.${encodeURIComponent(user)}`,{method:"DELETE"});
  return {premium:false,expires_at:null};
 }
 const row={auth_user_id:user,original_transaction_id:t.originalTransactionId,transaction_id:t.transactionId,
  product_id:t.productId,environment:t.environment,expires_at:new Date(t.expiresDate).toISOString(),checked_at:new Date(now).toISOString()};
 // UNIQUE original_transaction_id prevents transferring a purchase between accounts.
 await db("funnel_storekit_grants?on_conflict=auth_user_id",{method:"POST",headers:{prefer:"resolution=merge-duplicates"},body:JSON.stringify(row)});
 return {premium:true,expires_at:row.expires_at,product_id:t.productId};
}
async function verify(user,signed,{db=supabaseFetch,apple=configuration(),now=Date.now()}={}){
 if(typeof signed!=="string"||signed.length>40000||signed.split(".").length!==3)throw Error("invalid_storekit_transaction");
 const t=await apple.verifier.verifyAndDecodeTransaction(signed);
 if(t.bundleId!==bundleId||t.environment!==apple.environment||t.appAccountToken?.toLowerCase()!==user.toLowerCase()
  ||![...catalog.existing_entitlement_ids,...catalog.product_ids].includes(t.productId))throw Error("storekit_account_mismatch");
 return reconcile(user,t.originalTransactionId,{db,apple,now});
}
async function refresh(user,transactionId,options){return reconcile(user,transactionId,options);}
module.exports={verify,refresh,validTransaction,configuration};
