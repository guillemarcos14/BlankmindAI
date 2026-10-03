"use strict";
exports.handler=async event=>{
  // Scheduled function only; no unauthenticated public trigger.
  let body;try{body=JSON.parse(event.body||"{}");}catch(_){return {statusCode:403};}
  if(!Number.isFinite(Date.parse(body.next_run)))return {statusCode:403,body:"scheduled_only"};
  const result=await require("./bmb-worker-background").dispatch();
  return {statusCode:200,body:JSON.stringify(result)};
};
