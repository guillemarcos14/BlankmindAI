const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../web/funnel'),output=path.resolve(__dirname,'../tmp/funnel/web');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.otf':'font/otf','.svg':'image/svg+xml'};
 res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-section="pricing"]').click();await page.getByRole('heading',{name:'Your first plan stays free.'}).waitFor();
  await page.waitForFunction(()=>{
    const link=document.querySelector('[data-section="pricing"]'),nav=document.querySelector('.nav-scroll');
    const r=link.getBoundingClientRect(),n=nav.getBoundingClientRect();
    return link.getAttribute('aria-current')==='page'&&Math.abs(innerWidth<=800?r.left-n.left:r.top+r.height/2-n.top-nav.clientHeight/2)<2;
  });
  const pricing=await page.locator('.detail-copy').innerText();
  assert(/€2\.99.*month/.test(pricing)&&/€19\.99.*year/.test(pricing)&&/3-day free trial/.test(pricing));
  assert(!/free during its initial phase|30.day|not available to purchase/.test(pricing));
  await page.screenshot({path:path.join(output,`${name}-pricing.png`)});
  await page.getByRole('link',{name:'Start your free diagnosis'}).click();
  await page.locator('#answer').fill('I plan to read, but end up checking my phone in bed.');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#answer').fill('Video feeds keep me awake past my preferred bedtime.');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#answer').fill('Instagram and video feeds');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#bedtime').fill('23:00');await page.getByRole('button',{name:'See my proposal'}).click();
  assert((await page.locator('#proposal-copy').innerText()).includes('22:30 to 23:00'));
  await page.locator('#proposal').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${name}-proposal-viewport.png`)});
  let requests=0;
  await page.route('https://getblank.netlify.app/.netlify/functions/funnel-diagnosis',async route=>{
    requests++;const body=route.request().postDataJSON();assert.equal(body.consent,true);assert.equal(body.context.start_minute,1350);
    assert.equal(body.context.routine,'I plan to read, but end up checking my phone in bed.');
    await route.fulfill({status:requests===1?503:200,contentType:'application/json',body:JSON.stringify(requests===1?{error:'unavailable'}:{ok:true,token:'a'.repeat(64)})});
  });
  await page.getByRole('button',{name:'Continue in the app'}).click();assert.equal(requests,0,'No context leaves browser without consent');
  await page.locator('#transfer-consent').check();await page.getByRole('button',{name:'Continue in the app'}).click();
  await page.getByRole('status').filter({hasText:'Could not save'}).waitFor();
  await page.getByRole('button',{name:'Try again'}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${name}-transfer-error.png`)});
  await page.getByRole('button',{name:'Try again'}).click();await page.locator('#handoff').waitFor({state:'visible'});
  assert.equal(await page.locator('#open-app').getAttribute('href'),'blank://diagnosis?token='+'a'.repeat(64));
  assert.equal(await page.locator('#handoff-code').inputValue(),'a'.repeat(64));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  await page.locator('#open-app').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${name}-handoff-viewport.png`)});
  await page.getByRole('button',{name:'Revise my answers'}).click();assert.equal(await page.locator('#answer').inputValue(),'');
  assert.equal(errors.length,0,errors.join('\n'));await page.close();
 }
 console.log('PASS web: desktop/mobile, current navigation, offer, conversational diagnosis, personalized times, consent, outage retry, app handoff, revision and overflow; transfer API mocked, no publication');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
