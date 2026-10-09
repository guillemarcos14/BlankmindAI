"use strict";
const assert=require('node:assert/strict'),{build}=require('./bmb_decisions_release_corpus'),{evaluateTurn}=require('./bm_semantic_oracle'),{emptyState}=require('../netlify/functions/bm-semantic-state'),{measureConversationCoverage}=require('./bm_conversation_coverage');
const d=build();assert.equal(d.conversations.length,200);
const runs=d.conversations.map(c=>({turns:c.turns.map((t,i)=>({turn:i+1,input:t.input,source:'openai:fixture',status:'unverified',expected:t.expect}))}));
const r={runs,summary:{conversations:200,turns:200,passed:0,failed:0,unverified:200,active_model_turns:200}};assert.equal(measureConversationCoverage(r).unique_conversations,200);
const expected=d.conversations[0].turns[0].expect,body={plan:{semantic_state:emptyState('es'),actions:[],message_text:'7 horas y 1 minuto.'},semantic_decision:{type:'none',slot:null}};
const evaluated=evaluateTurn({expected,body});assert.deepEqual(evaluated.expected.factual_expectation,expected.factual_expectation);assert(!evaluated.issues.some(i=>i.dimension!=='visible_equivalence'));
const wrong=evaluateTurn({expected,body:{...body,plan:{...body.plan,actions:[{type:'start_protection',minutes:30}]}}});assert.equal(wrong.status,'failed');
console.log('PASS BMB corpus: 200 measured unique input/expectation sequences, preserved factual gold for independent judge, unchanged rejection of unexpected actions');
