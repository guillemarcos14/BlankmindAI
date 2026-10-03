"use strict";
exports.config={schedule:"*/30 * * * *"};
exports.handler=async event=>{
  // Scheduled function only; no unauthenticated public trigger.
  if(event.httpMethod)return {statusCode:403,body:"scheduled_only"};
  const result=await require("./bmb-worker-background").dispatch();
  return {statusCode:200,body:JSON.stringify(result)};
};
