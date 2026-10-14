"use strict";
// Frozen build input for esbuild/nft. CI verifies every runtime source before
// packaging; no directory scans or source files are needed inside a Lambda.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"../netlify/functions"),output=path.join(root,"bm-agent-runtime.json");
function actual(){return {version:1,hash_format:"utf8-lf-sha256",source_hashes:Object.fromEntries(fs.readdirSync(root).filter(n=>/\.(?:js|mjs)$/.test(n)).sort().map(n=>[n,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,n),"utf8").replace(/\r\n/g,"\n")).digest("hex")]))};}
function verify(){const frozen=JSON.parse(fs.readFileSync(output,"utf8"));assert.deepEqual(frozen,actual(),"Agent runtime changed: regenerate fingerprint and repeat evaluation; previous approval is stale");return frozen.source_hashes;}
if(require.main===module){if(process.argv.includes("--write"))fs.writeFileSync(output,JSON.stringify(actual(),null,2)+"\n");else{verify();console.log("PASS frozen agent runtime matches all function sources");}}
module.exports={actual,verify};
