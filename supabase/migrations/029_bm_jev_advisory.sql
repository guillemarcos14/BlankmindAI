-- Advisory turn metadata, recovered by the existing scheduled BMB worker.
-- No duplicate message queue, personal facts, action grants or native receipts.
create table public.bm_jev_turn_labels (
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 turn_id uuid not null references public.assistant_app_turns(id) on delete cascade,
 taxonomy text not null default 'blankmind-topics-1', model text not null default 'jev-1.13.0',
 status text not null check(status in ('processing','completed','failed','forgotten')),
 mode text not null check(mode in ('shadow','experiment')),
 attempts integer not null default 0 check(attempts between 0 and 2),
 lease_token uuid, lease_until timestamptz, next_retry_at timestamptz,
 result jsonb, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(auth_user_id,turn_id,taxonomy)
);
create table public.bm_jev_spend (
 day date primary key, attempts integer not null default 0,
 reserved_usd numeric not null default 0 check(reserved_usd>=0)
);
alter table public.bm_jev_turn_labels enable row level security;
alter table public.bm_jev_spend enable row level security;
revoke all on public.bm_jev_turn_labels,public.bm_jev_spend from public,anon,authenticated;
grant all on public.bm_jev_turn_labels,public.bm_jev_spend to service_role;
create policy bm_jev_labels_service on public.bm_jev_turn_labels for all to service_role using(true) with check(true);
create policy bm_jev_spend_service on public.bm_jev_spend for all to service_role using(true) with check(true);

create function public.bm_jev_reserve(p_user uuid,p_turn uuid,p_since timestamptz,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.assistant_app_turns%rowtype; r public.bm_jev_turn_labels%rowtype; cutoff timestamptz; previous jsonb; token uuid:=gen_random_uuid();
begin
 if p_mode is null or p_mode not in ('shadow','experiment') or p_since is null or p_since<now()-interval '7 days' or p_since>now() then return jsonb_build_object('claimed',false); end if;
 -- Server-only fixture metadata, not client context, proves this is synthetic QA.
 if not exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'synthetic_staging_run' ~* '^[a-f0-9]{8}-[a-f0-9-]{27}$') then return jsonb_build_object('claimed',false); end if;
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 select * into t from assistant_app_turns where auth_user_id=p_user and id=p_turn;
 if not found or (p_mode='shadow' and t.status<>'completed') or (p_mode='experiment' and t.status<>'processing') or t.created_at<p_since then return jsonb_build_object('claimed',false); end if;
 select max(source_at) into cutoff from bm_brain_memories where auth_user_id=p_user and value is null;
 if cutoff is not null and t.created_at<=cutoff then return jsonb_build_object('claimed',false); end if;
 select * into r from bm_jev_turn_labels where auth_user_id=p_user and turn_id=p_turn and taxonomy='blankmind-topics-1' for update;
 if found and (r.status in ('completed','forgotten') or r.attempts>=2 or r.lease_until>now() or r.next_retry_at>now()) then return jsonb_build_object('claimed',false); end if;
 -- Hard fleet-wide bound: <=1000 requests and $1 reserved per UTC day.
 -- Failed/timeout requests keep the reservation because billing is unknown.
 insert into bm_jev_spend(day) values((now() at time zone 'UTC')::date) on conflict do nothing;
 update bm_jev_spend set attempts=attempts+1,reserved_usd=reserved_usd+0.001
 where day=(now() at time zone 'UTC')::date and attempts<1000 and reserved_usd+0.001<=1;
 if not found then return jsonb_build_object('claimed',false); end if;
 insert into bm_jev_turn_labels(auth_user_id,turn_id,status,mode,attempts,lease_token,lease_until)
 values(p_user,p_turn,'processing',p_mode,1,token,now()+interval '20 seconds')
 on conflict(auth_user_id,turn_id,taxonomy) do update set status='processing',mode=p_mode,attempts=bm_jev_turn_labels.attempts+1,
 lease_token=token,lease_until=now()+interval '20 seconds',next_retry_at=null,result=null,error_code=null,updated_at=now();
 select jsonb_build_object('user',left(user_text,600),'assistant',left(assistant_text,600)) into previous from assistant_app_turns
 where auth_user_id=p_user and status='completed' and created_at<t.created_at and created_at>coalesce(cutoff,'-infinity'::timestamptz)
 order by created_at desc,id desc limit 1;
 return jsonb_build_object('claimed',true,'token',token,'text',t.user_text,'previous_turn',previous);
end $$;

create function public.bm_jev_finish(p_user uuid,p_turn uuid,p_token uuid,p_result jsonb,p_error text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.bm_jev_turn_labels%rowtype; t public.assistant_app_turns%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 select * into r from bm_jev_turn_labels where auth_user_id=p_user and turn_id=p_turn and taxonomy='blankmind-topics-1' for update;
 if not found or r.lease_token is distinct from p_token or r.status<>'processing' or r.lease_until<=now() then return jsonb_build_object('saved',false); end if;
 select * into t from assistant_app_turns where auth_user_id=p_user and id=p_turn;
 if not found or exists(select 1 from bm_brain_memories where auth_user_id=p_user and value is null and source_at>=t.created_at) then
   update bm_jev_turn_labels set status='forgotten',result=null,error_code=null,lease_token=null,lease_until=null where auth_user_id=p_user and turn_id=p_turn;
   return jsonb_build_object('saved',false);
 end if;
 if p_error is not null and p_error !~ '^jev_[a-z0-9_]{1,60}$' then raise exception 'jev_invalid_error'; end if;
 if p_error is null and (p_result is null or jsonb_typeof(p_result)<>'object' or length(p_result::text)>16000
   or p_result->>'model' is distinct from 'jev-1.13.0' or p_result->>'taxonomy' is distinct from 'blankmind-topics-1'
   or p_result->>'provenance' is distinct from 'typesafe_systemone' or p_result->>'mode' is distinct from r.mode) then raise exception 'jev_invalid_result'; end if;
 update bm_jev_turn_labels set status=case when p_error is null then 'completed' else 'failed' end,result=p_result,error_code=p_error,
 lease_token=null,lease_until=null,next_retry_at=now()+interval '5 minutes',updated_at=now() where auth_user_id=p_user and turn_id=p_turn;
 return jsonb_build_object('saved',true);
end $$;

create function public.bm_jev_pending(p_users uuid[],p_since timestamptz) returns table(auth_user_id uuid,id uuid)
language sql security definer set search_path=public as $$
 select t.auth_user_id,t.id from assistant_app_turns t join auth.users u on u.id=t.auth_user_id
 left join bm_jev_turn_labels l on l.auth_user_id=t.auth_user_id and l.turn_id=t.id and l.taxonomy='blankmind-topics-1'
 where cardinality(p_users)<=20 and t.auth_user_id=any(p_users) and t.status='completed' and t.created_at>=p_since
 and p_since>=now()-interval '7 days' and u.raw_app_meta_data->>'synthetic_staging_run' ~* '^[a-f0-9]{8}-[a-f0-9-]{27}$'
 and not exists(select 1 from bm_brain_memories m where m.auth_user_id=t.auth_user_id and m.value is null and m.source_at>=t.created_at)
 and (l.turn_id is null or (l.status in ('failed','processing') and l.attempts<2 and coalesce(l.lease_until,'-infinity')<=now() and coalesce(l.next_retry_at,'-infinity')<=now()))
 order by t.created_at,t.id limit 20;
$$;

create function public.bm_jev_forget() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.value is null then
   update bm_jev_turn_labels l set status='forgotten',result=null,error_code=null,lease_token=null,lease_until=null
   from assistant_app_turns t where l.auth_user_id=new.auth_user_id and l.turn_id=t.id and t.created_at<=new.source_at;
 end if;
 return new;
end $$;
create trigger bm_jev_memory_tombstone after insert or update on public.bm_brain_memories for each row execute function public.bm_jev_forget();

create function public.bm_jev_conversation_labels(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('turn_id',l.turn_id,'model',l.model,'taxonomy',l.taxonomy,'result',l.result) order by t.created_at),'[]'::jsonb)
 from bm_jev_turn_labels l join assistant_app_turns t on t.id=l.turn_id and t.auth_user_id=l.auth_user_id
 where l.auth_user_id=p_user and l.status='completed' and t.status='completed'
 and t.created_at>coalesce((select max(source_at) from bm_brain_memories where auth_user_id=p_user and value is null),'-infinity'::timestamptz);
$$;
revoke all on function public.bm_jev_reserve(uuid,uuid,timestamptz,text),public.bm_jev_finish(uuid,uuid,uuid,jsonb,text),public.bm_jev_pending(uuid[],timestamptz),public.bm_jev_conversation_labels(uuid),public.bm_jev_forget() from public,anon,authenticated;
grant execute on function public.bm_jev_reserve(uuid,uuid,timestamptz,text),public.bm_jev_finish(uuid,uuid,uuid,jsonb,text),public.bm_jev_pending(uuid[],timestamptz),public.bm_jev_conversation_labels(uuid) to service_role;
