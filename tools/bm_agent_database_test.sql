-- Disposable PostgreSQL only. Real transactions/RPCs, no external providers.
begin;
do $$ begin if current_database() not like '%test%' then raise exception 'Disposable test database required'; end if; end $$;
insert into auth.users(id) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
do $$
declare u uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; v uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 t uuid:=gen_random_uuid(); correction uuid:=gen_random_uuid(); inflight uuid:=gen_random_uuid(); forgetting uuid:=gen_random_uuid();
 r jsonb; tok uuid; result jsonb:='{"model":"gpt-6-luna","taxonomy":"blankmind-agent-1","input_tokens":100,"labels":[{"id":"memory:bedtime","topic":"sleep","type":"routine"}]}'; before_spend numeric;
begin
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect)
 values(t,u,'Me acuesto a las 23:00','Lo tengo en cuenta','completed',now(),now()-interval '3 minutes',
  '{"operation":"set","key":"bedtime","value":"23:00","evidence":"23:00"}');
 perform commit_assistant_brain_memory(u,t);
 if (bm_agent_labels_reserve(v,t,1)->>'claimed')::boolean then raise exception 'Foreign turn exposed'; end if;
 if (bm_agent_labels_reserve(u,t,0)->>'claimed')::boolean then raise exception 'Missing budget accepted'; end if;
 if (bm_agent_labels_reserve(u,t,0.005)->>'claimed')::boolean then raise exception 'Upper bound not reserved'; end if;
 r:=bm_agent_labels_reserve(u,t,0.03);tok:=(r->>'token')::uuid;
 if not (r->>'claimed')::boolean or r->'fragments'->0->>'text'<>'23:00' then raise exception 'Committed fact not reserved'; end if;
 if (bm_agent_labels_reserve(u,t,0.03)->>'claimed')::boolean then raise exception 'Replay reserved twice'; end if;
 if (bm_agent_labels_finish(u,t,gen_random_uuid(),r->>'source_hash',result,true)->>'saved')::boolean then raise exception 'Wrong token accepted'; end if;
 begin
  perform bm_agent_labels_finish(u,t,tok,r->>'source_hash','{}',true);
  raise exception 'Missing labels accepted';
 exception when raise_exception then if sqlerrm<>'invalid_agent_labels' then raise; end if; end;
 begin
  perform bm_agent_labels_finish(u,t,tok,r->>'source_hash',jsonb_set(result,'{labels}','[{"id":"memory:bedtime","topic":"sleep"}]'),true);
  raise exception 'Null label type accepted';
 exception when raise_exception then if sqlerrm<>'invalid_agent_label' then raise; end if; end;
 if not (bm_agent_labels_finish(u,t,tok,r->>'source_hash',result,true)->>'saved')::boolean then raise exception 'Labels not saved'; end if;
 if (bm_agent_labels_finish(u,t,tok,r->>'source_hash',result,true)->>'saved')::boolean then raise exception 'Finish replay accepted'; end if;
 if not exists(select 1 from bm_agent_labels where auth_user_id=u and turn_id=t and status='completed') then raise exception 'Missing persisted labels'; end if;
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect)
 values(correction,u,'Ahora me acuesto a la 01:00','Actualizado','completed',now(),now()-interval '2 minutes',
  '{"operation":"set","key":"bedtime","value":"01:00","evidence":"01:00"}');
 perform commit_assistant_brain_memory(u,correction);
 if exists(select 1 from bm_agent_labels where turn_id=t) then raise exception 'Correction retained stale labels'; end if;
 if (bm_agent_labels_reserve(u,t,0.03)->>'claimed')::boolean then raise exception 'Stale memory reclassified'; end if;
 r:=bm_agent_labels_reserve(u,correction,0.03);tok:=(r->>'token')::uuid;
 if not (r->>'claimed')::boolean then raise exception 'Correction not classifiable'; end if;
 select reserved_usd into before_spend from bm_agent_label_spend where day=current_date;
 perform bm_agent_labels_finish(u,correction,tok,r->>'source_hash',null,true);
 if (select reserved_usd from bm_agent_label_spend where day=current_date)<>before_spend then raise exception 'Unknown billed usage refunded'; end if;
 if (bm_agent_labels_reserve(u,correction,0.03)->>'claimed')::boolean then raise exception 'Unknown billed attempt retried'; end if;
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect)
 values(inflight,u,'Mi preferencia es descansar','Anotado','completed',now(),now()-interval '1 minute',
  '{"operation":"set","key":"preferences","value":"descansar","evidence":"descansar"}');
 perform commit_assistant_brain_memory(u,inflight);
 r:=bm_agent_labels_reserve(u,inflight,0.05);tok:=(r->>'token')::uuid;
 if not (r->>'claimed')::boolean then raise exception 'Inflight fact not reserved'; end if;
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect)
 values(forgetting,u,'Olvida todo','Hecho','completed',now(),now(),'{"operation":"forget_all","key":null,"value":null,"evidence":"Olvida todo"}');
 perform commit_assistant_brain_memory(u,forgetting);
 if exists(select 1 from bm_agent_labels where auth_user_id=u) then raise exception 'Forgetting left labels'; end if;
 if (bm_agent_labels_finish(u,inflight,tok,r->>'source_hash',result,true)->>'saved')::boolean then raise exception 'Late provider restored forgotten labels'; end if;
 if (bm_agent_labels_reserve(u,inflight,0.05)->>'claimed')::boolean then raise exception 'Forgotten turn reclassified'; end if;
 if has_function_privilege('anon','bm_agent_labels_reserve(uuid,uuid,numeric)','execute') or has_function_privilege('authenticated','bm_agent_labels_finish(uuid,uuid,uuid,text,jsonb,boolean)','execute') then raise exception 'Client can write labels'; end if;
 if has_table_privilege('authenticated','bm_agent_labels','select') then raise exception 'Labels publicly readable'; end if;
end $$;
rollback;
