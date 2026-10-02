-- Disposable PostgreSQL only. Test memory mutations against real SQL, not mocks.
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at,brain_memory_effect) values
 ('00000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mi objetivo es dormir mejor','Saved','completed',now(),'2026-10-01T12:00:00Z','{"operation":"set","key":"goal","value":"dormir mejor","evidence":"dormir mejor"}'),
 ('00000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Corrige mi objetivo: concentrarme','Saved','completed',now(),'2026-10-02T12:00:00Z','{"operation":"set","key":"goal","value":"concentrarme","evidence":"concentrarme"}'),
 ('00000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Olvida todos mis recuerdos','Forgotten','completed',now(),'2026-10-03T12:00:00Z','{"operation":"forget_all","key":null,"value":null,"evidence":"Olvida todos mis recuerdos"}'),
 ('00000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recuerda trabajo de noche','Saved','completed',now(),'2026-10-02T13:00:00Z','{"operation":"set","key":"work_routine","value":"trabajo de noche","evidence":"trabajo de noche"}'),
 ('00000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recuerda trabajo de día','Saved','completed',now(),'2026-10-04T12:00:00Z','{"operation":"set","key":"work_routine","value":"trabajo de día","evidence":"trabajo de día"}'),
 ('00000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Olvida mi rutina','Forgotten','completed',now(),'2026-10-05T12:00:00Z','{"operation":"forget","key":"work_routine","value":null,"evidence":"Olvida mi rutina"}');
do $$
declare r jsonb; saved_time timestamptz;
begin
  r:=public.commit_assistant_brain_memory('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-4000-8000-000000000001');
  if (r->>'committed')::boolean then raise exception 'Cross-account commit'; end if;
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002');
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001');
  if (select value from public.bm_brain_memories where key='goal') <> 'concentrarme' then raise exception 'Late commit overwrote correction'; end if;
  select updated_at into saved_time from public.bm_brain_memories where key='goal';
  r:=public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002');
  if not (r->>'duplicate')::boolean then raise exception 'Replay not idempotent'; end if;
  if (select updated_at from public.bm_brain_memories where key='goal') <> saved_time then raise exception 'Replay mutated memory'; end if;
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000003');
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000004');
  if exists(select 1 from public.bm_brain_memories where value is not null) then raise exception 'Late commit resurrected forgotten memory'; end if;
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000005');
  if (select value from public.bm_brain_memories where key='work_routine') <> 'trabajo de día' then raise exception 'New memory after forget-all lost'; end if;
  perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000006');
  if exists(select 1 from public.bm_brain_memories where key='work_routine' and (value is not null or source_text is not null)) then raise exception 'Specific forget leaked value'; end if;
  if has_table_privilege('authenticated','public.bm_brain_memories','SELECT') or has_table_privilege('anon','public.bm_brain_memories','INSERT') then raise exception 'Client has memory access'; end if;
  if has_function_privilege('authenticated','public.commit_assistant_brain_memory(uuid,uuid)','EXECUTE') then raise exception 'Client can mutate another account'; end if;
end $$;
update public.assistant_app_turns set brain_memory_effect='{"operation":"set","key":"name","value":"invented","evidence":"invented"}',brain_memory_applied_at=null where id='00000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.commit_assistant_brain_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001');
    raise exception 'Ungrounded memory accepted';
  exception when others then
    if sqlerrm <> 'invalid_brain_memory_evidence' then raise; end if;
  end;
end $$;
rollback;
select 'Brain memory: account isolation, grounding, corrections, replay, forgetting and privileges passed' as result;
