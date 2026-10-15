"use strict";
// Preload into every Node subprocess of the free local validation runner.
// Tests may install explicit mocks, but accidental real sockets fail closed.
const deny=()=>{throw Error('local_validation_network_forbidden');};
globalThis.fetch=async()=>deny();
for(const [name,methods] of Object.entries({http:['request','get'],https:['request','get'],net:['connect','createConnection'],tls:['connect'],http2:['connect']})){
 const api=require('node:'+name);for(const method of methods)api[method]=deny;
}
require('node:net').Socket.prototype.connect=deny;
