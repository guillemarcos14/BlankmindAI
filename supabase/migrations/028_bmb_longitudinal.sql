-- Individual evidence timeline and daily assessments. Coordinated release only.
create table public.bmb_observations (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 source_key text not null, metric text not null,
 value_number double precision, value_text text, unit text not null,
 measured_at timestamptz not null, timezone text not null,
 source text not null check(source in ('user_statement','user_report','native_health')),
 measurement text not null check(measurement in ('declared','routine_statement','measured')),
 evidence text, confidence double precision not null default 1 check(confidence between 0 and 1),
 status text not null default 'active' check(status in ('active','superseded','forgotten')),
 source_turn_id uuid references public.assistant_app_turns(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(auth_user_id,source_key,metric),
 check(value_number is null or value_text is null),
 check(status='forgotten' or value_number is not null or value_text is not null)
);
create index bmb_observations_timeline on public.bmb_observations(auth_user_id,measured_at desc) where status='active';
create table public.bmb_daily_reviews (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete cascade,
 local_day date not null, timezone text not null, status text not null default 'processing'
 check(status in ('processing','completed','failed','forgotten')),
 lease_token uuid not null default gen_random_uuid(), lease_until timestamptz not null default now()+interval '10 minutes',
 attempts integer not null default 1, report jsonb, created_at timestamptz not null default now(),
 unique(auth_user_id,local_day)
);
create table public.bmb_followups (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete cascade,
 review_id uuid not null references public.bmb_daily_reviews(id) on delete cascade,
 topic_key text not null, metric text not null, question text not null check(length(question) between 1 and 600),
 evidence_ids jsonb not null default '[]', status text not null default 'open'
 check(status in ('open','answered','dismissed','expired','forgotten')),
 answer_text text, answer_turn_id uuid references public.assistant_app_turns(id) on delete set null,
 answered_at timestamptz, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days'
);
create unique index bmb_followups_one_open_topic on public.bmb_followups(auth_user_id,topic_key) where status='open';
create index bmb_followups_owner on public.bmb_followups(auth_user_id,created_at desc);
alter table public.bmb_observations enable row level security;
alter table public.bmb_daily_reviews enable row level security;
alter table public.bmb_followups enable row level security;
revoke all on public.bmb_observations,public.bmb_daily_reviews,public.bmb_followups from public,anon,authenticated;
grant all on public.bmb_observations,public.bmb_daily_reviews,public.bmb_followups to service_role;
create policy bmb_observations_service on public.bmb_observations for all to service_role using(true) with check(true);
create policy bmb_daily_reviews_service on public.bmb_daily_reviews for all to service_role using(true) with check(true);
create policy bmb_followups_service on public.bmb_followups for all to service_role using(true) with check(true);

create function public.bmb_validate_observation(o jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare lo double precision:=0; hi double precision; expected text; n double precision;
begin
 case o->>'metric'
 when 'bedtime','sleep_onset','wake_time' then hi:=1439; expected:='local_minute';
 when 'sleep_duration' then hi:=1440; expected:='minutes';
 when 'restfulness','energy','stress','mood' then hi:=10; expected:='score_0_10';
 when 'caffeine','alcohol' then hi:=30; expected:='servings';
 when 'work_routine','routine_change','travel','illness','goal','preferences','constraints','weak_moments','exercise','environment','life_context'
 then return o->>'value_number' is null and o->>'unit'='text' and length(trim(o->>'value_text')) between 1 and 400;
 else return false;
 end case;
 if jsonb_typeof(o->'value_number') is distinct from 'number' or o->>'value_text' is not null then return false; end if;
 n:=(o->>'value_number')::double precision;
 return n between lo and hi and o->>'unit'=expected;
end $$;

-- Extends the existing atomic memory commit, without another replay mechanism.
create function public.bmb_capture_completed_turn() returns trigger
language plpgsql security definer set search_path=public as $$
declare e jsonb:=new.brain_memory_effect; o jsonb; idx integer:=0; resolution jsonb; cutoff timestamptz; f public.bmb_followups%rowtype;
begin
 if new.status<>'completed' or new.brain_memory_applied_at is null or old.brain_memory_applied_at is not null then return new; end if;
 if e is null then return new; end if;
 if e->>'operation' in ('forget','forget_all') then
   -- A memory tombstone cuts off all automatic historical personalization.
   update bmb_observations set status='forgotten',value_number=null,value_text=null,evidence=null
     where auth_user_id=new.auth_user_id and created_at<=new.created_at;
   update bmb_daily_reviews set status='forgotten',report=null
     where auth_user_id=new.auth_user_id and created_at<=new.created_at;
   update bmb_followups set status='forgotten',answer_text=null,question='Forgotten',evidence_ids='[]'
     where auth_user_id=new.auth_user_id and created_at<=new.created_at;
   return new;
 end if;
 select max(source_at) into cutoff from bm_brain_memories where auth_user_id=new.auth_user_id and value is null;
 if cutoff is not null and new.created_at<=cutoff then return new; end if;
 -- Start tracking for a linked app user who supplies personal information,
 -- without enabling notifications or autonomous device actions.
 insert into bmb_accounts(auth_user_id,app_install_id,settings)
 select new.auth_user_id,i.app_install_id,jsonb_build_object('timezone',coalesce(e#>>'{observations,0,timezone}','UTC'))
 from blankmind_identity_links i where i.auth_user_id=new.auth_user_id
 on conflict(auth_user_id) do nothing;
 if e->>'operation'='set' and e->>'key' in ('goal','work_routine','bedtime','weak_moments','preferences','constraints')
   and exists(select 1 from bm_brain_memories where auth_user_id=new.auth_user_id and key=e->>'key' and source_turn_id=new.id) then
   update bmb_observations set status='superseded' where auth_user_id=new.auth_user_id
     and metric=e->>'key' and measurement='routine_statement' and status='active' and measured_at<=new.created_at;
   insert into bmb_observations(auth_user_id,source_key,metric,value_text,unit,measured_at,timezone,source,measurement,evidence,source_turn_id,created_at)
   values(new.auth_user_id,'memory:'||new.id,e->>'key',e->>'value','text',new.created_at,'UTC','user_statement','routine_statement',e->>'evidence',new.id,new.created_at)
   on conflict do nothing;
 end if;
 if jsonb_typeof(coalesce(e->'observations','[]'))<>'array' or jsonb_array_length(coalesce(e->'observations','[]'))>12 then raise exception 'bmb_invalid_observations'; end if;
 for o in select value from jsonb_array_elements(coalesce(e->'observations','[]')) loop
   if not coalesce(bmb_validate_observation(o),false) or length(trim(coalesce(o->>'evidence','')))=0 or strpos(new.user_text,o->>'evidence')=0
     or (o->>'value_text' is not null and strpos(new.user_text,o->>'value_text')=0)
     or (o->>'measured_at' is not null and ((o->>'measured_at')::timestamptz>now()+interval '30 seconds' or (o->>'measured_at')::timestamptz<new.created_at-interval '366 days'))
     or o->>'measurement' not in ('declared','routine_statement')
     or not exists(select 1 from pg_timezone_names where name=o->>'timezone') then raise exception 'bmb_invalid_observation'; end if;
   idx:=idx+1;
   -- Corrections supersede the same source/metric/time, preserving the audit trail.
   update bmb_observations set status='superseded' where auth_user_id=new.auth_user_id and status='active'
     and metric=o->>'metric' and source='user_statement' and measurement=o->>'measurement'
     and measured_at=coalesce((o->>'measured_at')::timestamptz,new.created_at) and source_turn_id<>new.id;
   insert into bmb_observations(auth_user_id,source_key,metric,value_number,value_text,unit,measured_at,timezone,source,measurement,evidence,source_turn_id,created_at)
   values(new.auth_user_id,'turn:'||new.id||':'||idx,o->>'metric',(o->>'value_number')::double precision,o->>'value_text',o->>'unit',
     coalesce((o->>'measured_at')::timestamptz,new.created_at),o->>'timezone','user_statement',o->>'measurement',o->>'evidence',new.id,new.created_at) on conflict do nothing;
 end loop;
 resolution:=e->'followup_resolution';
 if resolution is not null and resolution<>'null'::jsonb then
   select * into f from bmb_followups where auth_user_id=new.auth_user_id and id=(resolution->>'id')::uuid for update;
   if not found or resolution->>'status' not in ('answered','dismissed') or length(trim(coalesce(resolution->>'evidence','')))=0
      or strpos(new.user_text,resolution->>'evidence')=0 then raise exception 'bmb_invalid_followup_answer'; end if;
   if f.status='open' and f.expires_at>new.created_at then
     update bmb_followups set status=resolution->>'status',answer_text=resolution->>'evidence',answer_turn_id=new.id,answered_at=new.created_at where id=f.id;
   end if;
 end if;
 return new;
end $$;
create trigger bmb_completed_turn after update of brain_memory_applied_at on public.assistant_app_turns
for each row execute function public.bmb_capture_completed_turn();

create function public.bmb_claim_daily_review(p_user uuid,p_day date,p_timezone text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.bmb_daily_reviews%rowtype; cutoff timestamptz; inserted uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 if not exists(select 1 from bmb_accounts where auth_user_id=p_user) or p_day<>(now() at time zone p_timezone)::date then return jsonb_build_object('claimed',false); end if;
 select max(source_at) into cutoff from bm_brain_memories where auth_user_id=p_user and value is null;
 insert into bmb_daily_reviews(auth_user_id,local_day,timezone) values(p_user,p_day,p_timezone) on conflict do nothing returning id into inserted;
 select * into r from bmb_daily_reviews where auth_user_id=p_user and local_day=p_day for update;
 if inserted is null and (r.status in ('completed','forgotten') or r.lease_until>now() or r.attempts>=3) then return jsonb_build_object('claimed',false); end if;
 update bmb_daily_reviews set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',
   attempts=case when r.status='failed' or r.lease_until<=now() then r.attempts+1 else r.attempts end where id=r.id returning * into r;
 return jsonb_build_object('claimed',true,'token',r.lease_token,'cutoff',cutoff);
end $$;

create function public.bmb_finish_daily_review(p_user uuid,p_day date,p_token uuid,p_report jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.bmb_daily_reviews%rowtype; topic text; f public.bmb_followups%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 select * into r from bmb_daily_reviews where auth_user_id=p_user and local_day=p_day for update;
 if not found or r.lease_token<>p_token or r.status<>'processing' or r.lease_until<=now() then return jsonb_build_object('saved',false); end if;
 if exists(select 1 from bm_brain_memories where auth_user_id=p_user and value is null and source_at>=r.created_at) then
   update bmb_daily_reviews set status='forgotten',report=null where id=r.id; return jsonb_build_object('saved',false); end if;
 if jsonb_typeof(p_report)<>'object' or length(trim(coalesce(p_report->>'summary','')))=0 or length(p_report::text)>40000 then raise exception 'bmb_invalid_review'; end if;
 update bmb_daily_reviews set status='completed',report=p_report,lease_until=now() where id=r.id;
 update bmb_followups set status='expired' where auth_user_id=p_user and status='open' and expires_at<=now();
 if p_report->>'question' is not null and length(trim(p_report->>'question'))>0 then
   topic:=p_report->>'question_metric';
   -- Pending, answered or rejected topics have a seven-day cooldown; no paraphrase spam.
   if topic is null or length(p_report->>'question')>600 then raise exception 'bmb_invalid_question'; end if;
   if not exists(select 1 from bmb_followups where auth_user_id=p_user and topic_key=topic and (status='open' or coalesce(answered_at,created_at)>now()-interval '7 days')) then
     insert into bmb_followups(auth_user_id,review_id,topic_key,metric,question,evidence_ids)
       values(p_user,r.id,topic,topic,p_report->>'question',coalesce(p_report->'evidence_ids','[]')) returning * into f;
   end if;
 end if;
 return jsonb_build_object('saved',true,'review_id',r.id,'followup_id',f.id);
end $$;
create function public.bmb_fail_daily_review(p_user uuid,p_day date,p_token uuid) returns void
language sql security definer set search_path=public as $$
 update bmb_daily_reviews set status='failed',lease_until=now()+interval '30 minutes'
 where auth_user_id=p_user and local_day=p_day and lease_token=p_token and status='processing';
$$;
revoke all on function public.bmb_validate_observation(jsonb),public.bmb_capture_completed_turn(),public.bmb_claim_daily_review(uuid,date,text),public.bmb_finish_daily_review(uuid,date,uuid,jsonb),public.bmb_fail_daily_review(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.bmb_validate_observation(jsonb),public.bmb_claim_daily_review(uuid,date,text),public.bmb_finish_daily_review(uuid,date,uuid,jsonb),public.bmb_fail_daily_review(uuid,date,uuid) to service_role;

-- Existing personal memories also participate; keep existing permission settings.
insert into bmb_accounts(auth_user_id,app_install_id,settings)
select distinct m.auth_user_id,i.app_install_id,'{"timezone":"UTC"}'::jsonb
from bm_brain_memories m join blankmind_identity_links i using(auth_user_id)
where m.value is not null on conflict(auth_user_id) do nothing;

-- The existing commit also accepts observation-only / followup-only effects.
create or replace function public.commit_assistant_brain_memory(p_auth_user_id uuid, p_turn_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.assistant_app_turns%rowtype;
  effect jsonb;
  op text;
  memory_key text;
  memory_value text;
  evidence text;
  reset_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('brain-memory:' || p_auth_user_id::text, 0));
  select * into t from public.assistant_app_turns
    where auth_user_id=p_auth_user_id and id=p_turn_id for update;
  if not found or t.status <> 'completed' then return jsonb_build_object('committed',false); end if;
  if t.brain_memory_applied_at is not null then return jsonb_build_object('committed',true,'duplicate',true); end if;
  effect := t.brain_memory_effect;
  if effect is not null and effect->>'operation' is not null then
    op := effect->>'operation'; memory_key := effect->>'key';
    memory_value := effect->>'value'; evidence := effect->>'evidence';
    if op is null or op not in ('set','forget','forget_all') or evidence is null or length(trim(evidence))=0
        or strpos(t.user_text,evidence)=0
        or (op <> 'forget_all' and (memory_key is null or memory_key not in ('name','goal','work_routine','bedtime','weak_moments','preferences','constraints')))
        or (op='set' and (memory_value is null or length(trim(memory_value)) not between 1 and 400 or strpos(t.user_text,memory_value)=0))
      then raise exception 'invalid_brain_memory_evidence'; end if;
    if op='forget_all' then
      update public.bm_brain_memories set value=null, source_text=null, source_at=t.created_at,
        source_turn_id=t.id, updated_at=now() where auth_user_id=p_auth_user_id and source_at <= t.created_at;
      insert into public.bm_brain_memories(auth_user_id,key,value,source_text,source_turn_id,source_at)
        values(p_auth_user_id,'_reset',null,null,t.id,t.created_at)
        on conflict(auth_user_id,key) do update set value=null, source_text=null,
          source_turn_id=excluded.source_turn_id,source_at=excluded.source_at,updated_at=now()
          where bm_brain_memories.source_at <= excluded.source_at;
    else
      select source_at into reset_at from public.bm_brain_memories where auth_user_id=p_auth_user_id and key='_reset';
      if reset_at is null or reset_at < t.created_at then
        insert into public.bm_brain_memories(auth_user_id,key,value,source_text,source_turn_id,source_at)
          values(p_auth_user_id,memory_key,case when op='set' then memory_value end,
            case when op='set' then evidence end,t.id,t.created_at)
          on conflict(auth_user_id,key) do update set value=excluded.value,source_text=excluded.source_text,
            source_turn_id=excluded.source_turn_id,source_at=excluded.source_at,updated_at=now()
            where bm_brain_memories.source_at <= excluded.source_at;
      end if;
    end if;
  end if;
  update public.assistant_app_turns set brain_memory_applied_at=now()
    where auth_user_id=p_auth_user_id and id=p_turn_id;
  return jsonb_build_object('committed',true);
end $$;
revoke all on function public.commit_assistant_brain_memory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_assistant_brain_memory(uuid,uuid) to service_role;

-- Assess every configured BM account daily, even with notification permission off.
-- Active protection/notification accounts retain their existing five-minute tick.
create or replace function public.bmb_claim_due_account() returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype; active boolean;
begin
 select * into a from bmb_accounts where next_check_at<=clock_timestamp()
 order by next_check_at,auth_user_id for update skip locked limit 1;
 if not found then return null; end if;
 active:=coalesce((a.settings#>>'{grant,active}')::boolean,false) or coalesce((a.settings#>>'{notifications,enabled}')::boolean,false);
 update bmb_accounts set next_check_at=clock_timestamp()+case when active then interval '5 minutes' else interval '1 hour' end where auth_user_id=a.auth_user_id;
 return to_jsonb(a);
end $$;
