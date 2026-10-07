-- Disposable CI PostgreSQL only. Uses actual RPCs, RLS, leases and tombstones.
begin;
insert into auth.users(id,raw_app_meta_data) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"synthetic_staging_run":"11111111-1111-4111-8111-111111111111"}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{}');
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; v uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 t uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); inflight uuid:=gen_random_uuid(); real_turn uuid:=gen_random_uuid();
 r jsonb; token uuid; since_at timestamptz:=now()-interval '3 minutes'; result jsonb:='{"model":"jev-1.13.0","taxonomy":"blankmind-topics-1","provenance":"typesafe_systemone","mode":"shadow","topics":["sleep"],"sources":[],"intent":"question","abstained":false}';
begin
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at) values
 (t,u,'Sleep question','Reply','completed',now(),now()-interval '2 minutes'),
 (f,u,'Fail question','Reply','completed',now(),now()-interval '2 minutes'),
 (inflight,u,'In flight','Reply','completed',now(),now()-interval '2 minutes'),
 (real_turn,v,'Real personal data','Reply','completed',now(),now()-interval '2 minutes');
 if (bm_jev_reserve(v,real_turn,since_at,'shadow')->>'claimed')::boolean then raise exception 'Real user exposed to provider'; end if;
 if (bm_jev_reserve(v,t,since_at,'shadow')->>'claimed')::boolean then raise exception 'Wrong owner'; end if;
 if (bm_jev_reserve(u,t,null,'shadow')->>'claimed')::boolean then raise exception 'Missing start'; end if;
 if (bm_jev_reserve(u,t,since_at,null)->>'claimed')::boolean then raise exception 'Missing mode'; end if;
 r:=bm_jev_reserve(u,t,since_at,'shadow'); token:=(r->>'token')::uuid;
 if not (r->>'claimed')::boolean or r->>'text'<>'Sleep question' then raise exception 'Durable turn not reserved'; end if;
 if (bm_jev_reserve(u,t,since_at,'shadow')->>'claimed')::boolean then raise exception 'Concurrent reservation'; end if;
 if (bm_jev_finish(u,t,null,result,null)->>'saved')::boolean then raise exception 'Null lease token'; end if;
 if (bm_jev_finish(u,t,gen_random_uuid(),result,null)->>'saved')::boolean then raise exception 'Wrong lease token'; end if;
 if not (bm_jev_finish(u,t,token,result,null)->>'saved')::boolean then raise exception 'Labels not persisted'; end if;
 if (bm_jev_reserve(u,t,since_at,'shadow')->>'claimed')::boolean then raise exception 'Completed replay repeated call'; end if;
 if jsonb_array_length(bm_jev_conversation_labels(u))<>1 then raise exception 'Aggregate lost provenance'; end if;
 r:=bm_jev_reserve(u,f,since_at,'shadow');
 perform bm_jev_finish(u,f,(r->>'token')::uuid,null,'jev_http_429');
 if (bm_jev_reserve(u,f,since_at,'shadow')->>'claimed')::boolean then raise exception 'Retry ignored backoff'; end if;
 update bm_jev_turn_labels set next_retry_at=now()-interval '1 minute' where turn_id=f;
 r:=bm_jev_reserve(u,f,since_at,'shadow');
 if not (r->>'claimed')::boolean then raise exception 'Interrupted/failed work not recovered'; end if;
 perform bm_jev_finish(u,f,(r->>'token')::uuid,null,'jev_timeout');
 update bm_jev_turn_labels set next_retry_at=now()-interval '1 minute' where turn_id=f;
 if (bm_jev_reserve(u,f,since_at,'shadow')->>'claimed')::boolean then raise exception 'Retry budget exceeded'; end if;
 r:=bm_jev_reserve(u,inflight,since_at,'shadow');token:=(r->>'token')::uuid;
 insert into bm_brain_memories(auth_user_id,key,value,source_at) values(u,'_reset',null,now());
 if (bm_jev_finish(u,inflight,token,result,null)->>'saved')::boolean then raise exception 'Forget race restored labels'; end if;
 if exists(select 1 from bm_jev_turn_labels l where l.auth_user_id=u and (l.status<>'forgotten' or l.result is not null)) then raise exception 'Tombstone did not purge'; end if;
 if jsonb_array_length(bm_jev_conversation_labels(u))<>0 then raise exception 'Forgotten labels exposed'; end if;
 if exists(select 1 from bm_jev_pending(array[u],since_at)) then raise exception 'Forgotten work requeued'; end if;
 update bm_jev_spend set attempts=1000,reserved_usd=1 where day=(now() at time zone 'UTC')::date;
 insert into assistant_app_turns(id,auth_user_id,user_text,status,created_at) values(gen_random_uuid(),u,'new','processing',now()+interval '1 second') returning id into t;
 if (bm_jev_reserve(u,t,since_at,'experiment')->>'claimed')::boolean then raise exception 'Daily fleet spend exceeded'; end if;
end $$;
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; x uuid; selected_id uuid; bucket bigint; n integer;
begin
 if mod(get_byte(digest('00000000-0000-4000-8000-000000000001','sha256'),0)::bigint*16777216+
 get_byte(digest('00000000-0000-4000-8000-000000000001','sha256'),1)::bigint*65536+
 get_byte(digest('00000000-0000-4000-8000-000000000001','sha256'),2)::bigint*256+
 get_byte(digest('00000000-0000-4000-8000-000000000001','sha256'),3),100)<>48 then raise exception 'Cohort differs from JavaScript'; end if;
 for n in 1..20 loop
  loop
   x:=gen_random_uuid();
   bucket:=mod(get_byte(digest(x::text,'sha256'),0)::bigint*16777216+get_byte(digest(x::text,'sha256'),1)::bigint*65536+get_byte(digest(x::text,'sha256'),2)::bigint*256+get_byte(digest(x::text,'sha256'),3),100);
   exit when bucket>=5;
  end loop;
  insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at)
  values(x,u,'Unselected synthetic turn','Reply','completed',now(),now()+interval '1 second'+n*interval '1 millisecond');
 end loop;
 loop
  selected_id:=gen_random_uuid();
  bucket:=mod(get_byte(digest(selected_id::text,'sha256'),0)::bigint*16777216+get_byte(digest(selected_id::text,'sha256'),1)::bigint*65536+get_byte(digest(selected_id::text,'sha256'),2)::bigint*256+get_byte(digest(selected_id::text,'sha256'),3),100);
  exit when bucket<5;
 end loop;
 insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,created_at)
 values(selected_id,u,'Selected synthetic turn','Reply','completed',now(),now()+interval '2 seconds');
 if exists(select 1 from bm_jev_pending(array[u],now()-interval '1 minute') p where p.id=selected_id) then raise exception 'Fixture did not reproduce starvation'; end if;
 if not exists(select 1 from bm_jev_pending_sampled(array[u],now()-interval '1 minute',5) p where p.id=selected_id) then raise exception 'Selected turn starved behind twenty unselected turns'; end if;
 if exists(select 1 from bm_jev_pending_sampled(array[u],now()-interval '1 minute',0)) then raise exception 'Zero cohort returned work'; end if;
 if (select count(*) from bm_jev_pending_sampled(array[u],now()-interval '1 minute',100))<>20 then raise exception 'Batch bound lost'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform * from bm_jev_turn_labels;raise exception 'Authenticated table access';exception when insufficient_privilege then null;end;
 begin perform bm_jev_pending(array[]::uuid[],now());raise exception 'Authenticated RPC access';exception when insufficient_privilege then null;end;
 begin perform bm_jev_pending_sampled(array[]::uuid[],now(),100);raise exception 'Authenticated sampled RPC access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS Jev PostgreSQL ownership/synthetic gate/replay/leases/backoff/spend/forget race/RLS' as result;
