-- Disposable PostgreSQL. Actual migrations, triggers, leases and memory commit.
begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into bmb_accounts(auth_user_id,app_install_id,settings) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','install-A','{"timezone":"UTC"}');
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; v uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 r jsonb; token uuid; review_id uuid; followup_id uuid; t uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid(); effect jsonb; report jsonb;
begin
 r:=bmb_claim_daily_review(u,current_date,'UTC');
 if not (r->>'claimed')::boolean then raise exception 'Daily review not claimed %',r; end if;
 token:=(r->>'token')::uuid;
 if (bmb_claim_daily_review(u,current_date,'UTC')->>'claimed')::boolean then raise exception 'Concurrent daily claim'; end if;
 if (bmb_claim_daily_review(v,current_date,'UTC')->>'claimed')::boolean then raise exception 'Unregistered owner claimed'; end if;
 report:='{"summary":"Later sleep onset","confidence":0.7,"hypotheses":[],"question":"Has your routine changed?","question_metric":"sleep_onset","evidence_ids":["test-row"]}'::jsonb;
 if (bmb_finish_daily_review(v,current_date,token,report)->>'saved')::boolean then raise exception 'Cross-account review commit'; end if;
 if (bmb_finish_daily_review(u,current_date,gen_random_uuid(),report)->>'saved')::boolean then raise exception 'Wrong lease token'; end if;
 r:=bmb_finish_daily_review(u,current_date,token,report);
 if not (r->>'saved')::boolean then raise exception 'Review commit failed'; end if;
 review_id:=(r->>'review_id')::uuid; followup_id:=(r->>'followup_id')::uuid;
 if followup_id is null then raise exception 'Question not durable'; end if;
 if (bmb_claim_daily_review(u,current_date,'UTC')->>'claimed')::boolean then raise exception 'Daily review replay'; end if;
 effect:=jsonb_build_object('observations',jsonb_build_array(jsonb_build_object('metric','sleep_onset','value_number',1380,'value_text',null,'unit','local_minute',
   'measurement','declared','measured_at',null,'timezone','UTC','evidence','23:00')),
   'followup_resolution',jsonb_build_object('id',followup_id,'status','answered','evidence','work changed'));
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,brain_memory_effect)
   values(t,u,'23:00 because work changed','Understood','completed',now(),effect);
 perform commit_assistant_brain_memory(u,t);
 if (select count(*) from bmb_observations where auth_user_id=u)<>1 then raise exception 'Observation not committed'; end if;
 if (select status from bmb_followups where id=followup_id)<>'answered' then raise exception 'Reply not linked'; end if;
 if not (commit_assistant_brain_memory(u,t)->>'duplicate')::boolean then raise exception 'Turn not idempotent'; end if;
 if (select count(*) from bmb_observations where auth_user_id=u)<>1 then raise exception 'Replay fabricated observations'; end if;
 -- Rejection/answer cooldown prevents differently worded questions on the same topic.
 update bmb_daily_reviews set status='processing',lease_until=now()+interval '10 minutes' where id=review_id;
 r:=bmb_finish_daily_review(u,current_date,token,report||'{"question":"Why are you sleeping later?"}');
 if r->>'followup_id' is not null or (select count(*) from bmb_followups where auth_user_id=u)<>1 then raise exception 'Answered topic repeated'; end if;
 -- Ungrounded observation rolls back the entire memory transaction.
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,brain_memory_effect)
   values(bad,u,'nothing about sleep','Reply','completed',now(),effect);
 begin
   perform commit_assistant_brain_memory(u,bad); raise exception 'Fabricated evidence committed';
 exception when others then if sqlerrm<>'bmb_invalid_observation' then raise; end if; end;
 if (select brain_memory_applied_at from assistant_app_turns where id=bad) is not null then raise exception 'Partial commit survived'; end if;
 -- A new memory reset cancels an in-flight review and redacts the old evidence.
 update bmb_daily_reviews set status='processing',lease_until=now()+interval '10 minutes' where id=review_id;
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect)
 values(gen_random_uuid(),u,'Forget all my memories','Forgotten','completed',now(),now()+interval '1 second',
   '{"operation":"forget_all","key":null,"value":null,"evidence":"Forget all my memories"}') returning id into t;
 perform commit_assistant_brain_memory(u,t);
 if exists(select 1 from bmb_observations where auth_user_id=u and (status<>'forgotten' or evidence is not null or value_number is not null)) then raise exception 'Forget leaked observation'; end if;
 if exists(select 1 from bmb_followups where auth_user_id=u and (status<>'forgotten' or answer_text is not null)) then raise exception 'Forget leaked followup'; end if;
 if (bmb_finish_daily_review(u,current_date,token,report)->>'saved')::boolean then raise exception 'Stale assessment resurrected memory'; end if;
 if has_table_privilege('authenticated','bmb_observations','SELECT') or has_table_privilege('anon','bmb_followups','INSERT')
   or has_function_privilege('authenticated','bmb_claim_daily_review(uuid,date,text)','EXECUTE') then raise exception 'Public longitudinal access'; end if;
end $$;
-- Failed assessments have a 30-minute backoff and at most three attempts.
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; r jsonb; token uuid; i int;
begin
 delete from bmb_daily_reviews where auth_user_id=u;
 for i in 1..3 loop
   r:=bmb_claim_daily_review(u,current_date,'UTC');
   if not (r->>'claimed')::boolean then raise exception 'Retry % denied %',i,r; end if;
   token:=(r->>'token')::uuid; perform bmb_fail_daily_review(u,current_date,token);
   if (bmb_claim_daily_review(u,current_date,'UTC')->>'claimed')::boolean then raise exception 'Backoff ignored'; end if;
   update bmb_daily_reviews set lease_until=now()-interval '1 minute' where auth_user_id=u;
 end loop;
 if (bmb_claim_daily_review(u,current_date,'UTC')->>'claimed')::boolean then raise exception 'Review attempt budget bypass'; end if;
end $$;
rollback;
