'use strict';
// A guided, browser-local conversation. No claim of AI image analysis or sleep causation.
const questions=[
 'What does the hour before bed usually look like for you?',
 'What keeps you on your phone when you would prefer to stop?',
 'Which apps would you like to leave alone during that time?'
];
const answers=[];let proposed=null;let continuation=null;
const get=id=>document.getElementById(id);
const clock=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
get('answer-form').addEventListener('submit',event=>{
 event.preventDefault();const answer=get('answer').value.trim();if(!answer)return;
 const row=document.createElement('div');row.className='exchange';
 const prompt=document.createElement('p'),response=document.createElement('p');
 prompt.textContent=questions[answers.length];response.textContent=answer;row.append(prompt,response);get('conversation').append(row);
 answers.push(answer);get('answer').value='';
 if(answers.length<questions.length){get('question').textContent=questions[answers.length];get('answer').focus();}
 else{get('answer-form').hidden=true;get('window-form').hidden=false;get('bedtime').focus();}
});
get('window-form').addEventListener('submit',event=>{
 event.preventDefault();const [hour,minute]=get('bedtime').value.split(':').map(Number);
 if(!Number.isInteger(hour)||!Number.isInteger(minute))return;
 const end=hour*60+minute,start=(end-Number(get('winddown').value)+1440)%1440;
 proposed={routine:answers[0],difficulty:answers[1],apps:answers[2],start_minute:start,end_minute:end};
 get('proposal-copy').textContent=`You told us: “${answers[1]}”. A first experiment could be to protect ${answers[2]} from ${clock(start)} to ${clock(end)} on the days you choose in the app, leaving space before your preferred bedtime. We will carry your routine and these answers with the proposal.`;
 get('window-form').hidden=true;get('proposal').hidden=false;get('transfer').focus();
});
get('revise').addEventListener('click',()=>{
 answers.length=0;proposed=null;continuation=null;get('conversation').replaceChildren();get('proposal').hidden=true;
 get('transfer').hidden=false;get('transfer').textContent='Continue in the app';get('transfer-status').textContent='';
 get('handoff').hidden=true;get('transfer-consent').checked=false;get('question').textContent=questions[0];get('answer-form').hidden=false;get('answer').focus();
});
get('transfer').addEventListener('click',async()=>{
 if(!get('transfer-consent').checked){get('transfer-status').textContent='Choose whether to save your answers before continuing.';return;}
 if(!proposed)return;
 get('transfer').disabled=true;get('transfer-status').textContent='Saving your continuation…';
 try{
  // The deploy release supplies an HTTPS API URL after backend integration. Never send personal answers to an inferred host.
  const endpoint=document.querySelector('meta[name="blank-funnel-api"]')?.content;
  if(!endpoint||!endpoint.startsWith('https://'))throw Error('not_configured');
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:proposed,consent:true}),referrerPolicy:'no-referrer'});
  const result=await response.json();if(!response.ok||!/^([a-f0-9]{64})$/.test(result.token))throw Error('transfer_failed');
  continuation=result.token;get('handoff-code').value=continuation;get('open-app').href=`blank://diagnosis?token=${continuation}`;
  get('handoff').hidden=false;get('transfer').hidden=true;get('transfer-status').textContent='Ready to continue. Your free plan still needs to be configured and implemented on iPhone.';get('open-app').focus();
 }catch(_){get('transfer').textContent='Try again';get('transfer-status').textContent='Could not save your continuation. Your answers are still here. Choose Try again to retry.';}
 finally{get('transfer').disabled=false;}
});
get('copy-code').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(continuation);get('transfer-status').textContent='Continuation code copied.';}
 catch(_){get('handoff-code').focus();get('handoff-code').select();get('transfer-status').textContent='Select and copy your continuation code.';}
});
