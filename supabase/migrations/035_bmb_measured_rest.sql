-- Coordinated release only. Source-tagged Watch outcomes replace adherence as efficacy.
create table public.bmb_rest_context (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 app_install_id text not null, observed_at timestamptz not null,
 snapshot jsonb not null, forgotten_after timestamptz,
 updated_at timestamptz not null default now()
);
create table public.bmb_rest_nights (
 id uuid not null default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete cascade,
 date date not null, start_at timestamptz not null, end_at timestamptz not null,
 timezone text not null, source text not null check(source in ('apple_watch','apple_health')),
 source_bundle text not null, manual boolean not null, complete boolean not null,
 sleep_minutes double precision not null check(sleep_minutes>0 and sleep_minutes<=1200),
 awake_minutes double precision check(awake_minutes between 0 and 1440),
 rem_minutes double precision check(rem_minutes between 0 and 1440),
 deep_minutes double precision check(deep_minutes between 0 and 1440),
 core_minutes double precision check(core_minutes between 0 and 1440),
 in_bed_minutes double precision check(in_bed_minutes between 0 and 1440),
 observed_at timestamptz not null, primary key(auth_user_id,date), unique(id), check(end_at>start_at)
);
create table public.bmb_rest_experiments (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete cascade,
 action_id text not null, source_turn_id uuid references public.assistant_app_turns(id) on delete set null,
 hypothesis text not null check(length(hypothesis) between 1 and 600),
 metric text not null check(metric in ('sleep_continuity','sleep_duration_target','sleep_regularity')),
 target_minutes integer check(target_minutes between 180 and 720), reference_minute integer check(reference_minute between 0 and 1439),
 review_after_days integer not null check(review_after_days between 7 and 14),
 action jsonb not null, baseline jsonb not null, evidence_ids jsonb not null,
 excluded_dates jsonb not null default '[]', verified_at timestamptz,
 status text not null default 'awaiting_execution' check(status in ('awaiting_execution','active','completed','failed','cancelled','forgotten')),
 evaluation jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(auth_user_id,action_id),
 check(metric<>'sleep_duration_target' or target_minutes is not null),
 check(metric<>'sleep_regularity' or reference_minute is not null)
);
create unique index bmb_rest_one_active on public.bmb_rest_experiments(auth_user_id) where status in ('awaiting_execution','active');
create table public.bmb_rest_protection (
 auth_user_id uuid not null references auth.users(id) on delete cascade, id uuid not null, window_id uuid not null,
 started_at timestamptz not null, ended_at timestamptz, source text not null check(source='native_schedule_shield'),
 observed_at timestamptz not null, primary key(auth_user_id,id), check(ended_at is null or ended_at>=started_at)
);
alter table public.bmb_rest_protection enable row level security;
revoke all on public.bmb_rest_protection from public,anon,authenticated;
grant all on public.bmb_rest_protection to service_role;
create policy rest_protection_service on public.bmb_rest_protection for all to service_role using(true) with check(true);
alter table public.bmb_rest_context enable row level security;
alter table public.bmb_rest_nights enable row level security;
alter table public.bmb_rest_experiments enable row level security;
revoke all on public.bmb_rest_context,public.bmb_rest_nights,public.bmb_rest_experiments from public,anon,authenticated;
grant all on public.bmb_rest_context,public.bmb_rest_nights,public.bmb_rest_experiments to service_role;
create policy rest_context_service on public.bmb_rest_context for all to service_role using(true) with check(true);
create policy rest_nights_service on public.bmb_rest_nights for all to service_role using(true) with check(true);
create policy rest_experiments_service on public.bmb_rest_experiments for all to service_role using(true) with check(true);

create function public.bmb_sync_rest(p_user uuid,p_install text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare observed timestamptz; previous timestamptz; cutoff timestamptz; n jsonb; tz text;
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 if not exists(select 1 from blankmind_identity_links where auth_user_id=p_user and app_install_id=p_install) then raise exception 'rest_installation_mismatch'; end if;
 observed:=(p_snapshot->>'observed_at')::timestamptz; tz:=p_snapshot->>'timezone';
 if p_snapshot->>'schema_version'<>'1' or p_snapshot->>'objective'<>'improve_apple_watch_measured_sleep'
 or observed>clock_timestamp()+interval '30 seconds' or observed<clock_timestamp()-interval '24 hours'
 or not exists(select 1 from pg_timezone_names where name=tz)
 or jsonb_typeof(p_snapshot->'nights')<>'array' or jsonb_array_length(p_snapshot->'nights')>35 then raise exception 'rest_invalid_snapshot'; end if;
 select observed_at into previous from bmb_rest_context where auth_user_id=p_user for update;
 if previous>=observed then return jsonb_build_object('synced',true,'stale',true); end if;
 select max(source_at) into cutoff from bm_brain_memories where auth_user_id=p_user and value is null;
 if cutoff>=observed then return jsonb_build_object('synced',false,'reason','memory_cutoff'); end if;
 -- Do not resurrect pre-forget Health context, digital records or subjective input.
 if cutoff is not null then
   if jsonb_typeof(p_snapshot->'health_context')='object' then
     p_snapshot:=jsonb_set(p_snapshot,'{health_context,traits}','[]');
     p_snapshot:=jsonb_set(p_snapshot,'{health_context,metrics}',coalesce((select jsonb_agg(
       jsonb_set(jsonb_set(m,'{points}',coalesce((select jsonb_agg(p) from jsonb_array_elements(coalesce(m->'points','[]')) p
         where (p->>'date')::date>(cutoff at time zone tz)::date),'[]')),'{entries}',coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(m->'entries','[]')) e
         where (e->>'date')::timestamptz>cutoff),'[]')))
       from jsonb_array_elements(coalesce(p_snapshot#>'{health_context,metrics}','[]')) m),'[]'));
   end if;
   p_snapshot:=jsonb_set(p_snapshot,'{checkins}',coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_snapshot->'checkins','[]'))
     where (value->>'date')::date>(cutoff at time zone tz)::date),'[]'));
   p_snapshot:=jsonb_set(p_snapshot,'{phone_context}',coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_snapshot->'phone_context','[]'))
     where (value->>'occurred_at')::timestamptz>cutoff),'[]'));
   p_snapshot:=jsonb_set(p_snapshot,'{digital,rows}',coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_snapshot#>'{digital,rows}','[]'))
     where (value->>'start_at')::timestamptz>cutoff),'[]'));
   p_snapshot:=jsonb_set(p_snapshot,'{protection_intervals}',coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_snapshot->'protection_intervals','[]'))
     where (value->>'started_at')::timestamptz>cutoff),'[]'));
 end if;
 for n in select value from jsonb_array_elements(p_snapshot->'nights') loop
   if n->>'source'='synthetic' then continue; end if;
   if cutoff is not null and (n->>'end_at')::timestamptz<=cutoff then continue; end if;
   if n->>'source' not in ('apple_watch','apple_health') or jsonb_typeof(n->'manual')<>'boolean' or jsonb_typeof(n->'complete')<>'boolean'
   or (n->>'start_at')::timestamptz>=(n->>'end_at')::timestamptz or (n->>'end_at')::timestamptz>clock_timestamp()
   or (n->>'date')::date<>((n->>'end_at')::timestamptz at time zone tz)::date
   or (n->>'sleep_minutes')::double precision>extract(epoch from ((n->>'end_at')::timestamptz-(n->>'start_at')::timestamptz))/60+1 then raise exception 'rest_invalid_night'; end if;
   insert into bmb_rest_nights(auth_user_id,date,start_at,end_at,timezone,source,source_bundle,manual,complete,
     sleep_minutes,awake_minutes,rem_minutes,deep_minutes,core_minutes,in_bed_minutes,observed_at)
   values(p_user,(n->>'date')::date,(n->>'start_at')::timestamptz,(n->>'end_at')::timestamptz,tz,n->>'source',n->>'source_bundle',
     (n->>'manual')::boolean,(n->>'complete')::boolean,(n->>'sleep_minutes')::double precision,(n->>'awake_minutes')::double precision,
     (n->>'rem_minutes')::double precision,(n->>'deep_minutes')::double precision,(n->>'core_minutes')::double precision,(n->>'in_bed_minutes')::double precision,observed)
   on conflict(auth_user_id,date) do update set start_at=excluded.start_at,end_at=excluded.end_at,timezone=excluded.timezone,
     source=excluded.source,source_bundle=excluded.source_bundle,manual=excluded.manual,complete=excluded.complete,
     sleep_minutes=excluded.sleep_minutes,awake_minutes=excluded.awake_minutes,rem_minutes=excluded.rem_minutes,
     deep_minutes=excluded.deep_minutes,core_minutes=excluded.core_minutes,in_bed_minutes=excluded.in_bed_minutes,observed_at=excluded.observed_at
   where bmb_rest_nights.observed_at<excluded.observed_at;
 end loop;
 for n in select value from jsonb_array_elements(coalesce(p_snapshot->'protection_intervals','[]')) loop
   if cutoff is not null and (n->>'started_at')::timestamptz<=cutoff then continue; end if;
   if n->>'source'<>'native_schedule_shield' or (n->>'started_at')::timestamptz>clock_timestamp()
   or (n->>'ended_at')::timestamptz>clock_timestamp() then raise exception 'rest_invalid_protection_interval'; end if;
   insert into bmb_rest_protection(auth_user_id,id,window_id,started_at,ended_at,source,observed_at)
   values(p_user,(n->>'id')::uuid,(n->>'window_id')::uuid,(n->>'started_at')::timestamptz,(n->>'ended_at')::timestamptz,n->>'source',observed)
   on conflict(auth_user_id,id) do update set ended_at=excluded.ended_at,observed_at=excluded.observed_at
   where bmb_rest_protection.observed_at<excluded.observed_at and bmb_rest_protection.started_at=excluded.started_at
   and bmb_rest_protection.window_id=excluded.window_id and (bmb_rest_protection.ended_at is null or bmb_rest_protection.ended_at=excluded.ended_at);
 end loop;
 p_snapshot:=jsonb_set(p_snapshot,'{nights}',coalesce((select jsonb_agg(value) from jsonb_array_elements(p_snapshot->'nights')
   where value->>'source'<>'synthetic' and (cutoff is null or (value->>'end_at')::timestamptz>cutoff)),'[]'));
 insert into bmb_rest_context(auth_user_id,app_install_id,observed_at,snapshot,forgotten_after) values(p_user,p_install,observed,p_snapshot,cutoff)
 on conflict(auth_user_id) do update set app_install_id=excluded.app_install_id,observed_at=excluded.observed_at,snapshot=excluded.snapshot,forgotten_after=excluded.forgotten_after,updated_at=now();
 insert into bmb_accounts(auth_user_id,app_install_id,settings) values(p_user,p_install,jsonb_build_object('timezone',tz)) on conflict(auth_user_id) do nothing;
 update bmb_accounts set settings=jsonb_set(settings,'{rest}',coalesce(settings->'rest','{}')||'{"sharing_revoked":false}'::jsonb)
 where auth_user_id=p_user and coalesce((settings#>>'{rest,sharing_revoked}')::boolean,false);
 return jsonb_build_object('synced',true);
end $$;

create function public.bmb_rest_capture_turn() returns trigger
language plpgsql security definer set search_path=public as $$
declare effect jsonb:=new.brain_memory_effect; plan jsonb:=effect->'rest_experiment'; base jsonb; context_snapshot jsonb; a jsonb;
begin
 if new.status<>'completed' or new.brain_memory_applied_at is null or old.brain_memory_applied_at is not null then return new; end if;
 if effect->>'operation' in ('forget','forget_all') then
   delete from bmb_rest_nights where auth_user_id=new.auth_user_id;
   delete from bmb_rest_context where auth_user_id=new.auth_user_id;
   delete from bmb_rest_protection where auth_user_id=new.auth_user_id;
   update bmb_rest_experiments set status='forgotten',baseline='[]',evidence_ids='[]',hypothesis='Forgotten',evaluation=null,updated_at=now() where auth_user_id=new.auth_user_id;
   return new;
 end if;
 if effect->'rest_preferences' is not null and effect->'rest_preferences'<>'null' then
   if length(trim(effect#>>'{rest_preferences,evidence}'))=0 or strpos(new.user_text,effect#>>'{rest_preferences,evidence}')=0 then raise exception 'rest_invalid_preference_evidence'; end if;
   update bmb_accounts set settings=jsonb_set(settings,'{rest}',coalesce(settings->'rest','{}')||jsonb_build_object('weekdays',
     coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(settings#>'{rest,weekdays}','[2,3,4,5,6]'))
       where not (effect#>'{rest_preferences,excluded_weekdays}' @> jsonb_build_array(value))),'[]'))),version=version+1,updated_at=now()
   where auth_user_id=new.auth_user_id;
 end if;
 if effect->'rest_exclusions' is not null and effect->'rest_exclusions'<>'null' then
   if length(trim(effect#>>'{rest_exclusions,evidence}'))=0 or strpos(new.user_text,effect#>>'{rest_exclusions,evidence}')=0
   or jsonb_array_length(effect#>'{rest_exclusions,dates}') not between 1 and 5
   or exists(select 1 from jsonb_array_elements_text(effect#>'{rest_exclusions,dates}') d
     where not exists(select 1 from bmb_rest_nights where auth_user_id=new.auth_user_id and date=d::date)) then raise exception 'rest_invalid_exclusion_evidence'; end if;
   update bmb_rest_experiments set excluded_dates=(select jsonb_agg(d order by d) from
     (select distinct value d from jsonb_array_elements(excluded_dates||(effect#>'{rest_exclusions,dates}'))) x),updated_at=now()
   where auth_user_id=new.auth_user_id and id=(effect#>>'{rest_exclusions,experiment_id}')::uuid and status='active';
 end if;
 if plan is null or plan='null' then return new; end if;
 a:=plan->'action';
 if plan->>'metric' not in ('sleep_continuity','sleep_duration_target','sleep_regularity') or length(trim(plan->>'hypothesis')) not between 1 and 600
 or (plan->>'review_after_days')::int not between 7 and 14 or a->>'type' not in ('apply_schedule','update_schedule')
 or new.action_id is null then raise exception 'rest_invalid_experiment'; end if;
 if exists(select 1 from bmb_rest_experiments where auth_user_id=new.auth_user_id and status in ('awaiting_execution','active')) then return new; end if;
 select snapshot into context_snapshot from bmb_rest_context where auth_user_id=new.auth_user_id;
 if context_snapshot is null then return new; end if;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into base from bmb_rest_nights n where auth_user_id=new.auth_user_id
 and source='apple_watch' and not manual and complete and end_at<new.created_at and end_at>new.created_at-interval '35 days';
 if jsonb_array_length(base)<7 then return new; end if;
 insert into bmb_rest_experiments(auth_user_id,action_id,source_turn_id,hypothesis,metric,target_minutes,reference_minute,review_after_days,action,baseline,evidence_ids)
 values(new.auth_user_id,new.action_id,new.id,plan->>'hypothesis',plan->>'metric',(plan->>'target_minutes')::int,
 (plan->>'reference_minute')::int,(plan->>'review_after_days')::int,a,base,plan->'evidence_ids') on conflict do nothing;
 return new;
end $$;
create trigger bmb_rest_completed_turn after update of brain_memory_applied_at on public.assistant_app_turns for each row execute function public.bmb_rest_capture_turn();

create function public.bmb_rest_execution(p_user uuid,p_action_id text,p_status text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 update bmb_rest_experiments set status=case when p_status='verified' and coalesce((p_evidence->>'valid')::boolean,false) then 'active' else 'failed' end,
 verified_at=case when p_status='verified' and coalesce((p_evidence->>'valid')::boolean,false) then clock_timestamp() else null end,updated_at=now()
 where auth_user_id=p_user and action_id=p_action_id and status='awaiting_execution'
 and p_status in ('verified','delayed','failed','dismissed','expired');
 return jsonb_build_object('recorded',found);
end $$;

create function public.bmb_finish_rest_experiment(p_user uuid,p_id uuid,p_evaluation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if p_evaluation->>'objective'<>'improve_apple_watch_measured_sleep' or p_evaluation->>'status' not in ('improved','worse','unchanged')
 or (p_evaluation->>'intervention_count')::int<7 or jsonb_array_length(p_evaluation->'evidence_ids')<7
 or coalesce((p_evaluation->>'causal')::boolean,true) then raise exception 'rest_invalid_evaluation'; end if;
 update bmb_rest_experiments set evaluation=p_evaluation,status='completed',updated_at=now()
 where id=p_id and auth_user_id=p_user and status='active' and metric=p_evaluation->>'metric'
 and excluded_dates <@ coalesce(p_evaluation->'excluded_dates','[]')
 and clock_timestamp()>=verified_at+make_interval(days=>review_after_days);
 return jsonb_build_object('saved',found);
end $$;

create function public.bmb_rest_global_prior(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from bmb_accounts where auth_user_id=p_user and coalesce((settings#>>'{rest,global_learning_enabled}')::boolean,false)) then
   return jsonb_build_object('available',false,'reason','global_learning_not_enabled'); end if;
 select jsonb_agg(to_jsonb(g)) into result from (
   select metric,count(distinct e.auth_user_id) as users,count(*) as experiments,
   avg((evaluation->>'delta')::double precision) as mean_delta,
   count(*) filter(where evaluation->>'status'='improved')::double precision/count(*) as improved_fraction
   from bmb_rest_experiments e join bmb_accounts a using(auth_user_id)
   where e.auth_user_id<>p_user and e.status='completed' and e.updated_at>now()-interval '180 days'
   and coalesce((a.settings#>>'{rest,global_learning_enabled}')::boolean,false)
   group by metric having count(distinct e.auth_user_id)>=20
 ) g;
 return jsonb_build_object('available',result is not null,'rows',coalesce(result,'[]'),'role','weak_prior_only_personal_evidence_wins');
end $$;

create function public.bmb_revoke_rest(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('brain-memory:'||p_user::text,0));
 delete from bmb_rest_nights where auth_user_id=p_user;
 delete from bmb_rest_context where auth_user_id=p_user;
 delete from bmb_rest_protection where auth_user_id=p_user;
 update bmb_rest_experiments set status='forgotten',baseline='[]',evidence_ids='[]',hypothesis='Forgotten',evaluation=null where auth_user_id=p_user;
 update bmb_accounts set settings=jsonb_set(jsonb_set(jsonb_set(settings,'{grant,active}','false'),'{notifications,enabled}','false'),'{rest}','{"adjustments_enabled":false,"global_learning_enabled":false,"sharing_revoked":true}'),version=version+1 where auth_user_id=p_user;
end $$;
revoke all on function public.bmb_sync_rest(uuid,text,jsonb),public.bmb_rest_capture_turn(),public.bmb_rest_execution(uuid,text,text,jsonb),public.bmb_finish_rest_experiment(uuid,uuid,jsonb),public.bmb_rest_global_prior(uuid),public.bmb_revoke_rest(uuid) from public,anon,authenticated;
grant execute on function public.bmb_sync_rest(uuid,text,jsonb),public.bmb_rest_execution(uuid,text,text,jsonb),public.bmb_finish_rest_experiment(uuid,uuid,jsonb),public.bmb_rest_global_prior(uuid),public.bmb_revoke_rest(uuid) to service_role;

-- Extend the same locked authority and inbox for bounded measured-rest adjustments.
create or replace function public.bmb_claim_event(p_user uuid,p_event jsonb,p_version bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype; limits jsonb; n timestamptz:=clock_timestamp(); localday date; localminute int; s int; e int; event_id uuid; root text; daycap int; weekcap int; w jsonb; rest_limits jsonb; parent bmb_rest_experiments%rowtype; base jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('bmb:'||p_user::text,0));
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 if not found or a.version<>p_version or not exists(select 1 from blankmind_identity_links where auth_user_id=p_user and app_install_id=a.app_install_id) then return jsonb_build_object('claimed',false,'reason','grant_changed_or_installation'); end if;
 if (p_event->>'expires_at')::timestamptz<=n or coalesce((a.settings->>'paused_until')::timestamptz,'epoch')>n then return jsonb_build_object('claimed',false,'reason','expired_or_paused'); end if;
 limits:=a.settings->case when p_event->>'kind'='action' then 'grant' else 'notifications' end;
 if p_event->>'kind'='action' then
   if not coalesce((limits->>'active')::boolean,false) or (limits->>'expires_at')::timestamptz<=n or not (limits->'action_types' ? (p_event#>>'{action,type}'))
      or coalesce((p_event#>>'{action,hard_mode}')::boolean,false) or coalesce((p_event#>>'{action,minutes}')::int,0)>(limits->>'max_minutes')::int
      or p_event#>>'{action,type}' not in ('start_protection','update_schedule')
      or (p_event#>>'{action,type}' in ('start_protection','set_daily_limit') and coalesce((p_event#>>'{action,minutes}')::int,0)<5) then return jsonb_build_object('claimed',false,'reason','outside_grant'); end if;
   if p_event#>>'{action,type}'='update_schedule' then
     rest_limits:=a.settings->'rest';
     if not coalesce((rest_limits->>'adjustments_enabled')::boolean,false) or p_event#>>'{facts,source}'<>'measured_rest_iteration'
     or (p_event->'action') is distinct from (p_event#>'{facts,authorized_adjustment}') then return jsonb_build_object('claimed',false,'reason','rest_authority_mismatch'); end if;
     select * into parent from bmb_rest_experiments where auth_user_id=p_user and id=(p_event#>>'{facts,experiment_id}')::uuid and status='completed';
     if not found or parent.evaluation->>'status' not in ('worse','unchanged') then return jsonb_build_object('claimed',false,'reason','rest_evidence_unavailable'); end if;
     select value into w from bmb_rest_context c,jsonb_array_elements(c.snapshot#>'{schedule,windows}') where c.auth_user_id=p_user
       and c.observed_at>n-interval '24 hours' and lower(value->>'id')=lower(p_event#>>'{action,window_id}');
     if w is null or not coalesce((w->>'enabled')::boolean,false) or w->>'starts_at' is not null
     or (p_event#>>'{action,timezone}')<>(a.settings->>'timezone') or p_event#>>'{action,recurrence}' not in ('weekly','continuous')
     or (p_event#>'{action,weekdays}') is distinct from (w->'weekdays')
     or (p_event#>>'{action,end_minute}')::int<>(w->>'end_minute')::int
     or abs(mod((p_event#>>'{action,start_minute}')::int-(w->>'start_minute')::int+2160,1440)-720)>(rest_limits->>'max_shift_minutes')::int
     or not coalesce((rest_limits->'weekdays') @> (p_event#>'{action,weekdays}'),false)
     or exists(select 1 from jsonb_array_elements_text(p_event#>'{action,weekdays}') d where
       (p_event#>>'{action,start_minute}')::int>=(p_event#>>'{action,end_minute}')::int
       and not (rest_limits->'weekdays' @> jsonb_build_array(mod(d::int,7)+1)))
     or not (case when (rest_limits->>'start_minute')::int=(rest_limits->>'end_minute')::int then true
       when (rest_limits->>'start_minute')::int<(rest_limits->>'end_minute')::int then
         (p_event#>>'{action,start_minute}')::int>=(rest_limits->>'start_minute')::int and (p_event#>>'{action,end_minute}')::int<=(rest_limits->>'end_minute')::int
       else ((p_event#>>'{action,start_minute}')::int>=(rest_limits->>'start_minute')::int or (p_event#>>'{action,start_minute}')::int<(rest_limits->>'end_minute')::int)
         and ((p_event#>>'{action,end_minute}')::int>=(rest_limits->>'start_minute')::int or (p_event#>>'{action,end_minute}')::int<=(rest_limits->>'end_minute')::int) end)
     then return jsonb_build_object('claimed',false,'reason','rest_bounds_changed'); end if;
     if exists(select 1 from bmb_rest_experiments where auth_user_id=p_user and status in ('awaiting_execution','active')) then return jsonb_build_object('claimed',false,'reason','rest_experiment_active'); end if;
   end if;
   if exists(select 1 from bmb_events where auth_user_id=p_user and kind='action' and created_at>n-make_interval(mins=>(limits->>'min_interval_minutes')::int)) then return jsonb_build_object('claimed',false,'reason','minimum_interval'); end if;
 else
   if not coalesce((limits->>'enabled')::boolean,false) then return jsonb_build_object('claimed',false,'reason','notifications_disabled'); end if;
 end if;
 localday:=(n at time zone (a.settings->>'timezone'))::date;
 if p_event->>'kind'='action' and a.settings#>'{rest,weekdays}' is not null
 and not (a.settings#>'{rest,weekdays}' @> jsonb_build_array(extract(dow from n at time zone (a.settings->>'timezone'))::int+1)) then return jsonb_build_object('claimed',false,'reason','rest_day_excluded'); end if;
 root:=p_event->>'meaning_key';
 if p_event#>>'{facts,source}'='native_receipt' then
   select initiative_key into root from bmb_events where auth_user_id=p_user and id=(p_event#>>'{facts,event_id}')::uuid;
   root:=coalesce(root,p_event->>'meaning_key');
 end if;
 daycap:=greatest(case when coalesce((a.settings#>>'{grant,active}')::boolean,false) then (a.settings#>>'{grant,max_per_day}')::int else 0 end,
   case when coalesce((a.settings#>>'{notifications,enabled}')::boolean,false) then (a.settings#>>'{notifications,max_per_day}')::int else 0 end);
 weekcap:=greatest(case when coalesce((a.settings#>>'{grant,active}')::boolean,false) then (a.settings#>>'{grant,max_per_week}')::int else 0 end,
   case when coalesce((a.settings#>>'{notifications,enabled}')::boolean,false) then (a.settings#>>'{notifications,max_per_week}')::int else 0 end);
 if not exists(select 1 from bmb_events where auth_user_id=p_user and initiative_key=root and created_at>n-interval '7 days')
 and ((select count(distinct initiative_key) from bmb_events where auth_user_id=p_user and (created_at at time zone (a.settings->>'timezone'))::date=localday)>=daycap
 or (select count(distinct initiative_key) from bmb_events where auth_user_id=p_user and created_at>n-interval '7 days')>=weekcap)
 then return jsonb_build_object('claimed',false,'reason','shared_initiative_budget'); end if;
 localminute:=extract(hour from n at time zone (a.settings->>'timezone'))*60+extract(minute from n at time zone (a.settings->>'timezone'));
 s:=(limits->>'start_minute')::int; e:=(limits->>'end_minute')::int;
 if s<>e and not(case when s<e then localminute>=s and localminute<e else localminute>=s or localminute<e end) then return jsonb_build_object('claimed',false,'reason','quiet_hours'); end if;
 if (select count(*) from bmb_events where auth_user_id=p_user and kind=p_event->>'kind' and (created_at at time zone (a.settings->>'timezone'))::date=localday)>=(limits->>'max_per_day')::int
 or (select count(*) from bmb_events where auth_user_id=p_user and kind=p_event->>'kind' and created_at>n-interval '7 days')>=(limits->>'max_per_week')::int then return jsonb_build_object('claimed',false,'reason','budget'); end if;
 insert into bmb_events(auth_user_id,event_key,meaning_key,initiative_key,kind,priority,facts,grant_version,action,expires_at,outcome)
 values(p_user,p_event->>'event_key',p_event->>'meaning_key',root,p_event->>'kind',coalesce((p_event->>'priority')::int,0),p_event->'facts',p_version,p_event->'action',(p_event->>'expires_at')::timestamptz,
   jsonb_build_object('message_text',p_event->>'message_text'))
 on conflict do nothing returning id into event_id;
 if event_id is not null and p_event#>>'{action,type}'='update_schedule' then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into base from bmb_rest_nights r where auth_user_id=p_user
     and source='apple_watch' and not manual and complete and end_at>=parent.verified_at and end_at<n;
   if jsonb_array_length(base)<7 then raise exception 'rest_insufficient_iteration_baseline'; end if;
   insert into bmb_rest_experiments(auth_user_id,action_id,hypothesis,metric,target_minutes,reference_minute,review_after_days,action,baseline,evidence_ids)
   values(p_user,'bmb_'||event_id::text,parent.hypothesis,parent.metric,parent.target_minutes,parent.reference_minute,
     (a.settings#>>'{rest,review_after_days}')::int,p_event->'action',base,parent.evaluation->'evidence_ids');
 end if;
 return jsonb_build_object('claimed',event_id is not null,'id',event_id,'reason',case when event_id is null then 'duplicate' else 'reserved' end);
end $$;

create or replace function public.bmb_enqueue_event(p_user uuid,p_id uuid,p_action jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype; ev public.bmb_events%rowtype; pending jsonb; memory_key text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bmb:'||p_user::text,0));
 memory_key:='assistant:'||substr(encode(digest('app:'||p_user::text,'sha256'),'hex'),1,32);
 insert into assistant_semantic_conversations(anonymous_user_id,channel) values(memory_key,'whatsapp') on conflict do nothing;
 perform 1 from assistant_semantic_conversations where anonymous_user_id=memory_key for update;
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 select * into ev from bmb_events where auth_user_id=p_user and id=p_id and kind='action' for update;
 if not found or ev.grant_version<>a.version or ev.expires_at<=now() or not coalesce((a.settings#>>'{grant,active}')::boolean,false) then return jsonb_build_object('enqueued',false,'reason','revoked_or_expired'); end if;
 if p_action->>'id'<>'bmb_'||p_id::text or p_action->>'type'<>ev.action->>'type'
 or (p_action->>'expires_at')::timestamptz<>ev.expires_at or (p_action->>'minutes')::int is distinct from (ev.action->>'minutes')::int
 or (ev.action->>'type'='update_schedule' and
   (p_action->>'window_id' is distinct from ev.action->>'window_id' or p_action->>'start_minute' is distinct from ev.action->>'start_minute'
    or p_action->>'end_minute' is distinct from ev.action->>'end_minute' or p_action->'weekdays' is distinct from ev.action->'weekdays'
    or p_action->>'timezone' is distinct from ev.action->>'timezone' or p_action->>'recurrence' is distinct from ev.action->>'recurrence'))
 or coalesce((p_action->>'hard_mode')::boolean,false) or (p_action->>'grant_version')::bigint is distinct from ev.grant_version
 or not coalesce((p_action->>'autonomous')::boolean,false) then raise exception 'bmb_action_mismatch'; end if;
 if ev.outcome ? 'enqueued_at' then return jsonb_build_object('enqueued',true,'duplicate',true); end if;
 select payload#>'{properties,memory,pending_assistant_action}' into pending from digital_wellness_feature_payloads
 where anonymous_user_id=memory_key and (payload->'properties'->'memory') ? 'pending_assistant_action' order by submitted_at desc,id desc limit 1;
 if pending is not null and pending<>'null'::jsonb and (pending->>'expires_at')::timestamptz>now() and pending->>'status' not in ('verified','delayed','failed','dismissed','expired','superseded') then return jsonb_build_object('enqueued',false,'reason','inbox_busy'); end if;
 insert into digital_wellness_feature_payloads(anonymous_user_id,schema_version,payload,insight,platform,data_consent)
 values(memory_key,1,jsonb_build_object('event','assistant_memory_updated','properties',jsonb_build_object('channel','app','memory',jsonb_build_object('pending_assistant_action',p_action),'source','bmb_autonomous_action')),'{}','ios',true);
 update bmb_events set outcome=outcome||jsonb_build_object('enqueued_at',now()) where id=p_id;
 update assistant_semantic_conversations set storage_version=storage_version+1,updated_at=now() where anonymous_user_id=memory_key;
 return jsonb_build_object('enqueued',true);
end $$;
revoke all on function public.bmb_save_settings(uuid,text,jsonb,bigint),public.bmb_claim_event(uuid,jsonb,bigint),public.bmb_enqueue_event(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bmb_save_settings(uuid,text,jsonb,bigint),public.bmb_claim_event(uuid,jsonb,bigint),public.bmb_enqueue_event(uuid,uuid,jsonb) to service_role;


