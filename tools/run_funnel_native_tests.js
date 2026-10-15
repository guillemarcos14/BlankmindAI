"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{spawnSync}=require("node:child_process");
const file=fs.readFileSync(path.join(__dirname,"../ios/Blank/Blank/BlankDomainModels.swift"),"utf8");
const start=file.indexOf("enum FunnelPolicy {"),end=file.indexOf("\nenum BlankmindAppPresence",start);
if(start<0||end<0)throw Error("Missing production FunnelPolicy boundary");
const folder=fs.mkdtempSync(path.join(os.tmpdir(),"blank-funnel-"));
try{
 fs.writeFileSync(path.join(folder,"main.swift"),"import Foundation\n"+file.slice(start,end)+fs.readFileSync(path.join(__dirname,"funnel_native_test.swift"),"utf8"));
 const binary=path.join(folder,"funnel-test");
 const build=spawnSync("swiftc",[path.join(folder,"main.swift"),"-o",binary],{encoding:"utf8"});
 if(build.error||build.status!==0)throw build.error||Error(build.stderr);
 const run=spawnSync(binary,[],{encoding:"utf8"});process.stdout.write(run.stdout||"");
 if(run.status!==0)throw Error(run.stderr);
}finally{fs.rmSync(folder,{recursive:true,force:true});}
