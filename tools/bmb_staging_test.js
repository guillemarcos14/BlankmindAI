const assert=require('node:assert/strict');const staging=require('./bmb_staging');const {dispatch}=require('../netlify/functions/bmb-worker-background');
(async()=>{
 assert.throws(()=>staging.assertSite('59955668-9a9b-4979-a283-63fbf3115fe5'));staging.assertEntries([...staging.ENTRIES].reverse());assert.throws(()=>staging.assertEntries(staging.ENTRIES.slice(1)));
 const before={URL:process.env.URL,KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,COOKIE:process.env.BMB_PRIVATE_STAGE_COOKIE,fetch:global.fetch};
 try{process.env.URL=staging.SITE_URL;process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';process.env.BMB_PRIVATE_STAGE_COOKIE='synthetic-cookie';let count=0;
 global.fetch=async(url,options)=>{count++;assert.equal(new URL(url).origin,staging.SITE_URL);assert.equal(options.headers.cookie,'synthetic-cookie');assert.ok(options.headers['x-bmb-signature']);return {status:202};};
 assert.deepEqual(await dispatch(),{accepted:true});assert.equal(count,1);process.env.URL='https://getblank.netlify.app';await assert.rejects(dispatch(),/bmb_private_stage_origin_invalid/);assert.equal(count,1);
 }finally{global.fetch=before.fetch;for(const [k,v]of [['URL',before.URL],['SUPABASE_SERVICE_ROLE_KEY',before.KEY],['BMB_PRIVATE_STAGE_COOKIE',before.COOKIE]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
 console.log('BMB staging isolation and protected worker dispatch passed');
})();
