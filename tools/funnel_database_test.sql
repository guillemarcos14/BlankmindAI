begin;
insert into auth.users(id) values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb');
do $$
declare u uuid:='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; v uuid:='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
 w uuid:='cccccccc-1111-4111-8111-cccccccccccc'; r jsonb;
begin
 perform funnel_implement_first(u,w,'{"registered":true}');
 perform funnel_implement_first(u,gen_random_uuid(),'{"registered":true}');
 if (select free_window_id from funnel_accounts where auth_user_id=u)<>w then raise exception 'Free window was replaced by a retry'; end if;
 if (select first_completed_at from funnel_accounts where auth_user_id=u) is not null then raise exception 'Registration invented completion'; end if;
 insert into funnel_diagnoses(token_hash,context) values ('test-hash','{"routine":"user-declared"}');
 r:=funnel_claim_diagnosis(u,'test-hash');
 if r->>'routine'<>'user-declared' then raise exception 'Handoff lost context'; end if;
 if funnel_claim_diagnosis(v,'test-hash') is not null then raise exception 'Another account stole diagnosis'; end if;
 if funnel_claim_diagnosis(u,'test-hash') is null then raise exception 'Owner cannot retry interrupted claim'; end if;
 update funnel_diagnoses set expires_at=now()-interval '1 second';
 if funnel_claim_diagnosis(u,'test-hash') is not null then raise exception 'Expired token reused'; end if;
 insert into funnel_storekit_grants values(u,'original','latest','existing-product','Sandbox',now()+interval '1 hour',now());
 begin
  insert into funnel_storekit_grants values(v,'original','latest','existing-product','Sandbox',now()+interval '1 hour',now());
  raise exception 'A purchase was transferred to another account';
 exception when unique_violation then null; end;
 if has_table_privilege('anon','public.funnel_storekit_grants','insert') or has_table_privilege('authenticated','public.funnel_accounts','update')
  or has_function_privilege('authenticated','public.funnel_implement_first(uuid,uuid,jsonb)','execute')
  or has_function_privilege('anon','public.funnel_claim_diagnosis(uuid,text)','execute') then raise exception 'Client can forge commercial state'; end if;
 if exists(select 1 from pg_class where oid in('funnel_accounts'::regclass,'funnel_storekit_grants'::regclass,'funnel_diagnoses'::regclass) and not relrowsecurity) then raise exception 'Funnel RLS missing'; end if;
end $$;
rollback;
