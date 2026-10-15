"use strict";
// Build a reviewable nine-entry release package. This tool cannot publish.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto"),{createRequire}=require("node:module"),{pathToFileURL}=require("node:url"),{execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),output=path.join(root,"tmp/funnel/package");
const entries=["account-data","app-auth","assistant-app","assistant-app-stream","assistant-app-voice","assistant-device","bmb-tick","bmb-worker-background","funnel-diagnosis"];
async function main(){
 const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",windowsHide:true}).trim();
 if(git("status","--porcelain"))throw Error("funnel_package_requires_clean_source");
 require("./bm_agent_runtime").verify();
 const cli=process.argv[2]||path.resolve(root,"../../tmp/netlify-cli-runtime/node_modules/netlify-cli/bin/run.js");
 const loader=createRequire(cli),modulePath=loader.resolve("@netlify/zip-it-and-ship-it");
 const {zipFunctions}=await import(pathToFileURL(modulePath).href);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"blank-funnel-package-"));
 const wrappers=path.join(folder,"wrappers");fs.mkdirSync(wrappers);fs.mkdirSync(output,{recursive:true});
 for(const name of entries){
  const extension=name.endsWith("-stream")||name.endsWith("-voice")?".mjs":".js";
  const entry=path.join(root,"netlify/functions",name+extension);
  fs.writeFileSync(path.join(wrappers,name+extension),extension===".mjs"?`export { default } from ${JSON.stringify(entry)};\n`:`exports.handler=require(${JSON.stringify(entry)}).handler;\n`);
 }
 try{
  const bundles=await zipFunctions(wrappers,output,{basePath:root,config:{"*":{nodeBundler:"esbuild",nodeVersion:"22"},"bmb-tick":{schedule:"*/5 * * * *"}}});
  if(bundles.length!==entries.length)throw Error("funnel_package_inventory_mismatch");
  const functions=bundles.map(bundle=>{
   const streaming=["assistant-app-stream","assistant-app-voice"].includes(bundle.name);
   if(streaming&&(bundle.invocationMode!=="stream"||bundle.runtimeAPIVersion!==2))throw Error("funnel_stream_packaging_mismatch");
   if(bundle.inputs.some(input=>/\.env(?:\.|$)|Secrets[\\/]/i.test(input)))throw Error("funnel_package_contains_sensitive_input");
   return {name:bundle.name,path:bundle.path,sha256:crypto.createHash("sha256").update(fs.readFileSync(bundle.path)).digest("hex"),bytes:fs.statSync(bundle.path).size,
    runtime_api_version:bundle.runtimeAPIVersion||1,invocation_mode:bundle.invocationMode||"buffered"};
  });
  const report={source_commit:git("rev-parse","HEAD"),source_tree_clean:true,mode:"package_only_no_deploy",functions};
  fs.writeFileSync(path.join(output,"funnel-package.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={entries};
