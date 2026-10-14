-- Decisions labels are advisory metadata over already committed explicit facts.
-- This migration is independent of legacy Jev migrations 029/030. Server only.
create table public.bm_agent_labels (
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 turn_id uuid not null references public.assistant_app_turns(id) on delete cascade,
 source_hash text not null, source_created_at timestamptz not null,
 fragments jsonb not null, status text not null check(status in ('processing','completed','failed')),
 lease_token uuid not null, lease_until timestamptz not null,
 result jsonb, created_at timestamptz not null default now(),
 primary key(auth_user_id,turn_id)
);
create index bm_agent_labels_recent on public.bm_agent_labels(auth_user_id,source_created_at desc);
create table public.bm_agent_label_spend (
 day date primary key, reserved_usd numeric not null default 0 check(reserved_usd>=0),
 known_input_tokens bigint not null default 0 check(known_input_tokens>=0), attempts integer not null default 0
);
alter table public.bm_agent_labels enable row level security;
alter table public.bm_agent_label_spend enable row level security;
revoke all on public.bm_agent_labels,public.bm_agent_label_spend from public,anon,authenticated;
grant all on public.bm_agent_labels,public.bm_agent_label_spend to service_role;
create policy bm_agent_labels_service on public.bm_agent_labels for all to service_role using(true) with check(true);
create policy bm_agent_label_spend_service on public.bm_agent_label_spend for all to service_role using(true) with check(true);

create function public.bm_agent_labels_reserve(p_user uuid,p_turn uuid,p_daily_limit numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.assistant_app_turns%rowtype; e jsonb; fragments jsonb:='[]'; o jsonb;
 tok uuid:=gen_random_uuid(); source_hash text; cutoff timestamptz; idx integer:=0; spent numeric;
begin
 if p_daily_limit is null or p_daily_limit<=0 or p_daily_limit>5 then return jsonb_build_object('claimed',false); end if;
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 select * into t from public.assistant_app_turns where id=p_turn and auth_user_id=p_user and status='completed' and brain_memory_applied_at is not null;
 if not found then return jsonb_build_object('claimed',false); end if;
 select max(source_at) into cutoff from public.bm_brain_memories where auth_user_id=p_user and value is null;
 if cutoff is not null and t.created_at<=cutoff then return jsonb_build_object('claimed',false); end if;
 e:=t.brain_memory_effect;
 if e->>'operation' in ('forget','forget_all') then return jsonb_build_object('claimed',false); end if;
 if e->>'operation'='set' and exists(select 1 from public.bm_brain_memories where auth_user_id=p_user and key=e->>'key' and source_turn_id=p_turn and value=e->>'value') then
  fragments:=fragments||jsonb_build_array(jsonb_build_object('id','memory:'||(e->>'key'),'text',e->>'value'));
 end if;
 for o in select value from jsonb_array_elements(case when jsonb_typeof(e->'observations')='array' then e->'observations' else '[]'::jsonb end) loop
  -- Existing commit validation establishes literal evidence, canonical units
  -- and declared/routine provenance. Labels never change any of these.
  if length(trim(o->>'evidence'))>0 and strpos(t.user_text,o->>'evidence')>0 then
   fragments:=fragments||jsonb_build_array(jsonb_build_object('id','observation:'||idx::text,'text',o->>'evidence','metric',o->>'metric'));
  end if;
  idx:=idx+1;
 end loop;
 if jsonb_array_length(fragments)=0 or jsonb_array_length(fragments)>13 or octet_length(fragments::text)>10000 then return jsonb_build_object('claimed',false); end if;
 source_hash:=md5(e::text);
 if exists(select 1 from public.bm_agent_labels where auth_user_id=p_user and turn_id=p_turn) then return jsonb_build_object('claimed',false); end if;
 perform pg_advisory_xact_lock(hashtextextended('bm-agent-label-budget:'||current_date::text,0));
 insert into public.bm_agent_label_spend(day) values(current_date) on conflict do nothing;
 select reserved_usd into spent from public.bm_agent_label_spend where day=current_date;
 -- Conservative bound for a <=32KB Decisions request; unknown billed attempts
 -- retain the full reservation and are never retried automatically.
 if spent+0.01>p_daily_limit then return jsonb_build_object('claimed',false); end if;
 update public.bm_agent_label_spend set reserved_usd=reserved_usd+0.01,attempts=attempts+1 where day=current_date;
 insert into public.bm_agent_labels(auth_user_id,turn_id,source_hash,source_created_at,fragments,status,lease_token,lease_until)
 values(p_user,p_turn,source_hash,t.created_at,fragments,'processing',tok,now()+interval '15 seconds');
 return jsonb_build_object('claimed',true,'token',tok,'source_hash',source_hash,'fragments',fragments);
end $$;

create function public.bm_agent_labels_finish(p_user uuid,p_turn uuid,p_token uuid,p_source_hash text,p_result jsonb,p_attempted boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.bm_agent_labels%rowtype; cutoff timestamptz; label jsonb; ids text[]:='{}'; tokens bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 select * into r from public.bm_agent_labels where auth_user_id=p_user and turn_id=p_turn for update;
 if not found or r.status<>'processing' or p_token is null or r.lease_token<>p_token or r.source_hash is distinct from p_source_hash or r.lease_until<now() then return jsonb_build_object('saved',false); end if;
 select max(source_at) into cutoff from public.bm_brain_memories where auth_user_id=p_user and value is null;
 if cutoff is not null and r.source_created_at<=cutoff then delete from public.bm_agent_labels where auth_user_id=p_user and turn_id=p_turn; return jsonb_build_object('saved',false); end if;
 if not exists(select 1 from public.assistant_app_turns where id=p_turn and auth_user_id=p_user and status='completed' and md5(brain_memory_effect::text)=r.source_hash) then return jsonb_build_object('saved',false); end if;
 if p_result is not null then
  if jsonb_typeof(p_result) is distinct from 'object' or not (p_result ?& array['model','taxonomy','input_tokens','labels'])
   or (select count(*) from jsonb_object_keys(p_result))<>4
   or p_result->>'model' is distinct from 'gpt-6-luna' or p_result->>'taxonomy' is distinct from 'blankmind-agent-1'
   or jsonb_typeof(p_result->'labels') is distinct from 'array' then raise exception 'invalid_agent_labels'; end if;
  if jsonb_array_length(p_result->'labels')<>jsonb_array_length(r.fragments) then raise exception 'invalid_agent_labels'; end if;
  for label in select value from jsonb_array_elements(p_result->'labels') loop
   if jsonb_typeof(label) is distinct from 'object' or not(label ?& array['id','topic','type'])
     or (select count(*) from jsonb_object_keys(label))<>3 or label->>'id' is null or label->>'id'=any(ids)
     or not exists(select 1 from jsonb_array_elements(r.fragments) f where f->>'id'=label->>'id')
     or coalesce(label->>'topic','') not in ('sleep','phone_habits','routine','preferences','other')
     or coalesce(label->>'type','') not in ('routine','episode','correction','preference','uncertain') then raise exception 'invalid_agent_label'; end if;
   ids:=array_append(ids,label->>'id');
  end loop;
  if coalesce(p_result->>'input_tokens','')!~'^\d+$' then raise exception 'invalid_agent_label_usage'; end if;
  tokens:=(p_result->>'input_tokens')::bigint;
  if tokens>100000 then raise exception 'invalid_agent_label_usage'; end if;
  update public.bm_agent_label_spend set reserved_usd=greatest(0,reserved_usd-0.01+tokens*0.10/1000000),known_input_tokens=known_input_tokens+tokens where day=r.created_at::date;
 elsif p_attempted is false then
  update public.bm_agent_label_spend set reserved_usd=greatest(0,reserved_usd-0.01) where day=r.created_at::date;
 end if;
 update public.bm_agent_labels set status=case when p_result is null then 'failed' else 'completed' end,result=p_result where auth_user_id=p_user and turn_id=p_turn;
 return jsonb_build_object('saved',p_result is not null);
end $$;

create function public.bm_agent_labels_invalidate() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.value is null then
  delete from public.bm_agent_labels where auth_user_id=new.auth_user_id and source_created_at<=new.source_at;
 elsif tg_op='UPDATE' and (old.value is distinct from new.value or old.source_turn_id is distinct from new.source_turn_id) then
  delete from public.bm_agent_labels where auth_user_id=new.auth_user_id and source_created_at<=new.source_at
   and fragments @> jsonb_build_array(jsonb_build_object('id','memory:'||new.key));
 end if;
 return new;
end $$;
create trigger bm_agent_labels_memory_change after insert or update on public.bm_brain_memories for each row execute function public.bm_agent_labels_invalidate();
revoke all on function public.bm_agent_labels_reserve(uuid,uuid,numeric),public.bm_agent_labels_finish(uuid,uuid,uuid,text,jsonb,boolean),public.bm_agent_labels_invalidate() from public,anon,authenticated;
grant execute on function public.bm_agent_labels_reserve(uuid,uuid,numeric),public.bm_agent_labels_finish(uuid,uuid,uuid,text,jsonb,boolean) to service_role;
