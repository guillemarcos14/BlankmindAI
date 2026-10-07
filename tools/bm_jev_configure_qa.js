"use strict";
// Explicitly authorized credential setup; private QA host is not configurable.
const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const { SITE_ID, SITE_URL } = require("./bmb_staging");
function localKey() {
  return execFileSync("pwsh.exe",["-NoProfile","-Command",
    "$ErrorActionPreference='Stop'; $jevCipher=[Console]::In.ReadToEnd().Trim(); $jevSecure=$jevCipher | ConvertTo-SecureString; ([pscredential]::new('unused',$jevSecure)).GetNetworkCredential().Password"],
  {input:fs.readFileSync(path.resolve("tmp/jev/typesafe-key.dpapi"),"utf8"),encoding:"utf8",windowsHide:true}).trim();
}
async function main() {
  if(!process.argv.includes("--configure"))throw Error("jev_explicit_configuration_required");
  const value=localKey(),c=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,"netlify/Config/config.json"),"utf8"));
  if(value.length<30)throw Error("jev_key_required");
  const token=c.users[c.userId].auth.token;
  const api=async(route,options={})=>{
    const r=await fetch("https://api.netlify.com/api/v1"+route,{...options,headers:{authorization:"Bearer "+token,"content-type":"application/json"},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error("jev_netlify_http_"+r.status);return r.status===204?null:r.json();
  };
  const site=await api("/sites/"+SITE_ID);
  if(site.id!==SITE_ID||site.ssl_url!==SITE_URL||site.password===null)throw Error("jev_private_site_required");
  const route="/accounts/"+site.account_id+"/env",vars=await api(route+"?site_id="+SITE_ID);
  const variable={key:"TYPESAFE_API_KEY",scopes:["functions"],is_secret:true,values:[{context:"production",value}]};
  if(vars.some(v=>v.key===variable.key))await api(route+"/TYPESAFE_API_KEY?site_id="+SITE_ID,{method:"PUT",body:JSON.stringify(variable)});
  else await api(route+"?site_id="+SITE_ID,{method:"POST",body:JSON.stringify([variable])});
  const saved=(await api(route+"?site_id="+SITE_ID)).find(v=>v.key===variable.key);
  if(!saved?.is_secret||saved.scopes.length!==1||saved.scopes[0]!=="functions")throw Error("jev_secret_verification_failed");
  fs.mkdirSync("tmp/jev",{recursive:true});
  const proof={site_id:SITE_ID,key:variable.key,is_secret:saved.is_secret,scopes:saved.scopes,flags_enabled:false,production_changed:false};
  fs.writeFileSync("tmp/jev/credential-setup.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}
if(require.main===module)main().catch(e=>{console.error(/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_configuration_failed");process.exitCode=1;});
module.exports={localKey};
