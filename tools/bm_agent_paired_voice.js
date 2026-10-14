"use strict";
// Called immediately after the real app turn commits, with the same start clock.
// Local authenticated handler + real provider; never claims iPhone playback.
const crypto=require("node:crypto");
async function measure({root,token,install,turn,started,text,remaining,fetcher=fetch}) {
 if(!text?.trim()||text.length>remaining)return {passed:false,error:"voice_character_cap",characters:0,first_audio_ms:null};
 const requestId=crypto.randomUUID(),requests=[];
 const response=await require(require("node:path").join(root,"netlify/functions/bm-voice-output")).voice(new Request("http://localhost/assistant-app-voice",{
  method:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify({turn_id:turn,request_id:requestId,app_install_id:install,synchronized:true,elevenlabs_consent:true})
 }),{fetch:async(url,options)=>{
  if(!/^https:\/\/api.elevenlabs.io\/v1\/text-to-speech\/[a-zA-Z0-9]{20}\/with-timestamps\?output_format=pcm_24000$/.test(String(url)))throw Error("voice_unexpected_provider");
  const body=JSON.parse(options.body);if(body.text!==text)throw Error("voice_committed_text_mismatch");
  const result=await fetcher(url,options);requests.push({provider:"elevenlabs",status:result.status,request_id:result.headers.get("request-id"),characters:text.length,model:body.model_id});return result;
 }});
 let first=null,bytes=0,error=null;
 if(!response.ok)error=(await response.json()).error;
 else {const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
  while(true){const next=await reader.read();if(next.done)break;buffer+=decoder.decode(next.value,{stream:true});let i;
   while((i=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const frame=JSON.parse(line);
    if(frame.type==="audio"){first??=performance.now()-started;bytes+=Buffer.from(frame.pcm,"base64").length;}if(frame.type==="error")error=frame.error;
   }
  }
 }
 return {passed:response.ok&&first!==null&&bytes>0&&!error,status:response.status,error,characters:requests.reduce((n,r)=>n+r.characters,0),first_audio_ms:first,audio_bytes:bytes,requests,cost_usd:null,physical_playback_tested:false,measurement:"actual turn input to first PCM from local authenticated voice handler"};
}
module.exports={measure};
