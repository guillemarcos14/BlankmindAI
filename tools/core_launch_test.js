"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),functions=path.join(root,"netlify/functions");
const retired=["whatsapp-agent","sms-agent","assistant-channel","assistant-action-retry-background","waitlist-agent","wearable-oauth-start","wearable-oauth-callback","wearable-sync","weather-context","wellness-signal","digital-wellness-features","blanked-agent"];
for(const name of retired)assert(!fs.existsSync(path.join(functions,name+".js")),name+" was restored");
// Every source import is resolvable, including ESM voice entry points.
for(const name of fs.readdirSync(functions).filter(n=>/\.(js|mjs)$/.test(n))){
 const source=fs.readFileSync(path.join(functions,name),"utf8");
 for(const match of source.matchAll(/(?:require\(|from\s+)["']\.\/([^"']+)/g)){
  assert(["",".js",".mjs",".json"].some(ext=>fs.existsSync(path.join(functions,match[1]+ext))),name+" has dangling import "+match[1]);
 }
 assert(!/TWILIO_|WHATSAPP_|WEARABLE_OAUTH_|sendSmsMessage|sendWhatsAppMessage/.test(source),name+" retains provider transport");
}
const memory=require("../netlify/functions/_assistant_memory");
assert.equal(memory.cleanChannel("app"),"app");
assert.equal(memory.cleanChannel("whatsapp"),"");assert.equal(memory.cleanChannel("sms"),"");
assert(!Object.hasOwn(memory,"sendAssistantMessage"));
const sources=require("../netlify/functions/bmb-sources").SOURCE_NAMES;
assert(sources.includes("rest_nights")&&sources.includes("rest_experiments")&&sources.includes("health_context"));
assert(!sources.some(n=>["wellness","wearables","wearable_connections"].includes(n)));
const project=fs.readFileSync(path.join(root,"ios/Blank/Blank.xcodeproj/project.pbxproj"),"utf8");
assert(!/Widget|8A000004|BC121200/.test(project));
const syntax=project.replace(/\/\*[\s\S]*?\*\//g,"").replace(/"(?:\\.|[^"\\])*"/g,"");
const stack=[];
for(const c of syntax){if(c==="{"||c==="(")stack.push(c);else if(c==="}"||c===")")assert.equal(stack.pop(),c==="}"?"{":"(","Xcode project has unbalanced target attributes");}
assert.equal(stack.length,0);
for(const name of ["SetupView.swift","ContentView.swift","HomeView.swift"]){
 const source=fs.readFileSync(path.join(root,"ios/Blank/Blank",name),"utf8");
 assert(!source.includes('path: "assistant-channel"'),"Native lifecycle still uses the retired endpoint");
 assert(source.includes('path: "assistant-device"'),"Native lifecycle lost its authenticated endpoint");
}
for(const name of ["BlankDeviceActivityMonitor","BlankShieldConfiguration","BlankShieldAction"])assert(project.includes(name),name+" core extension missing");
const brain=require("../netlify/functions/bmb-brain"),tools=require("../netlify/functions/bm-agent-tools");
const contract=tools.contract(brain.schema,["rest_evidence"]);
assert.deepEqual(contract.tools.map(t=>t.name),["consultar_contexto","gestionar"]);
for(const field of ["rest_experiment","rest_preferences","rest_exclusions","rest_claim"]){
 assert.deepEqual(contract.tools[1].parameters.properties[field],brain.schema.properties[field]);
 assert(contract.tools[1].parameters.required.includes(field));
 const managed=tools.decode({output:[{type:"function_call",name:"gestionar",arguments:JSON.stringify({[field]:{evidence:"user declaration"}})}]});
 assert.deepEqual(managed[field],{evidence:"user declaration"});
 assert.throws(()=>tools.decode({output_text:JSON.stringify({phase:"final",[field]:{evidence:"unauthorized"}})}),/reply_effects/);
 assert(require("../netlify/functions/bm-agent-authority").hasEffects(managed),field+" bypassed text-only authority");
}
assert(fs.existsSync(path.join(functions,"bm-agent-decisions.js"))&&fs.existsSync(path.join(functions,"bm-agent-labels.js")));
assert(/bmb_rest_global_prior/.test(fs.readFileSync(path.join(functions,"bmb-rest.js"),"utf8")));
console.log("PASS core launch: app-only transports, complete import graph, necessary iOS extensions, no widget target, sleep sources, rest fields in both domain tools and preserved advanced optimizations");
