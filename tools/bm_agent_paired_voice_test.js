"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),{measure}=require("./bm_agent_paired_voice");
async function main(){
 const root=path.resolve(__dirname,".."),voice=require("../netlify/functions/bm-voice-output"),original=voice.voice;
 let calls=0;
 try{
  voice.voice=async(request,deps)=>{calls++;const body=await request.json();assert.equal(body.turn_id,"turn");assert.equal(body.elevenlabs_consent,true);
   const r=await deps.fetch("https://api.elevenlabs.io/v1/text-to-speech/dNjJKg63Fr5AXwIdkATa/with-timestamps?output_format=pcm_24000",{body:JSON.stringify({text:"Hola",model_id:"eleven_multilingual_v2"})});
   assert.equal(r.status,200);return new Response(JSON.stringify({type:"audio",pcm:Buffer.from("pcm").toString("base64")})+"\n");
  };
  const options={root,token:"offline",install:"fixture",turn:"turn",started:performance.now()-100,text:"Hola",remaining:4,fetcher:async()=>new Response("",{headers:{"request-id":"offline"}})};
  const r=await measure(options);assert(r.passed);assert(r.first_audio_ms>=100);assert.equal(r.audio_bytes,3);assert.equal(r.cost_usd,null);assert.equal(r.physical_playback_tested,false);
  assert.equal((await measure({...options,remaining:3})).error,"voice_character_cap");assert.equal(calls,1,"Over-cap audio contacted provider");
  await assert.rejects(()=>measure({...options,text:"Adiós",remaining:5}),/committed_text_mismatch/);
 }finally{voice.voice=original;}
 console.log("PASS paired voice instrumentation: same input clock, committed text, actual PCM, preflight character cap and unknown USD; offline fixtures never qualify activation");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
