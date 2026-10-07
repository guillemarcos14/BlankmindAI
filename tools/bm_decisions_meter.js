"use strict";
// Consume usage at the actual HTTP boundary, including incomplete/repair calls.
// Streaming chunks pass through immediately; only numeric usage is retained.
function usage(value){if(!Number.isSafeInteger(value?.input_tokens)||!Number.isSafeInteger(value?.output_tokens))return null;
 return {input_tokens:value.input_tokens,output_tokens:value.output_tokens,cached_input_tokens:value.input_tokens_details?.cached_tokens||0,cache_write_tokens:value.input_tokens_details?.cache_write_tokens||0};}
function capture(row,body){const u=usage(body?.usage);if(u){row.usage=u;row.model=body.model;row.service_tier=body.service_tier||null;}}
async function meterResponse(response,row){row.status=response.status;
 if(!response.body)return response;
 if(!response.headers.get("content-type")?.includes("text/event-stream")){try{capture(row,await response.clone().json());}catch(_){}return response;}
 const decoder=new TextDecoder();let buffer="";
 const transform=new TransformStream({transform(chunk,controller){controller.enqueue(chunk);buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,"\n");
  let end;while((end=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split("\n").filter(s=>s.startsWith("data:")).map(s=>s.slice(5).trimStart()).join("\n");
   try{const event=JSON.parse(data);if(["response.completed","response.incomplete","response.failed"].includes(event.type))capture(row,event.response);}catch(_){}
  }
 }});
 return new Response(response.body.pipeThrough(transform),{status:response.status,statusText:response.statusText,headers:response.headers});
}
function estimate(row,rates){if(!row.usage)return null;const u=row.usage;
 if(row.endpoint==="decisions")return u.input_tokens*rates.decisions_input/1e6;
 if(row.service_tier&&!['default','standard'].includes(row.service_tier))return null;
 return (Math.max(0,u.input_tokens-u.cached_input_tokens-u.cache_write_tokens)*rates.input+u.cached_input_tokens*rates.cached+u.cache_write_tokens*rates.input*1.25+u.output_tokens*rates.output)/1e6;
}
module.exports={usage,capture,meterResponse,estimate};
