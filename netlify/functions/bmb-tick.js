"use strict";
const {supabaseFetch}=require("./_membership");
exports.config={schedule:"*/30 * * * *"};
exports.handler=async event=>{
  // Scheduled function only; no unauthenticated public trigger.
  if(event.httpMethod)return {statusCode:403,body:"scheduled_only"};
  let offset=0,processed=0,failed=0;
  do {
    const accounts=await supabaseFetch(`bmb_accounts?select=*&order=auth_user_id&limit=50&offset=${offset}`,{method:"GET"});
    for(const a of accounts) {
      if(!a.settings.grant?.active&&!a.settings.notifications?.enabled)continue;
      try {await require("./bmb-service").tickAccount(a);processed++;}catch(_){failed++;}
    }
    if(accounts.length<50)break;offset+=50;
  }while(offset<1000);
  return {statusCode:200,body:JSON.stringify({processed,failed})};
};
