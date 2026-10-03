-- Prepared only. Apply with the coordinated backend/iOS release, never from evaluation.
create table public.bmb_accounts (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 app_install_id text not null,
 settings jsonb not null default '{}',
 version bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.bmb_accounts add column next_check_at timestamptz not null default now();
alter table public.bmb_accounts add column last_assessment jsonb not null default '{}';
create function public.bmb_claim_assessment(p_user uuid,p_version bigint,p_event_key text)
returns boolean language plpgsql security definer set search_path=public as $$
declare a bmb_accounts%rowtype;
begin
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 if not found or a.version<>p_version then return false; end if;
 if a.last_assessment->>'event_key'=p_event_key and (a.last_assessment->>'version')::bigint=p_version
 and (a.last_assessment->>'until')::timestamptz>clock_timestamp() then return false; end if;
 update bmb_accounts set last_assessment=jsonb_build_object('event_key',p_event_key,'version',p_version,'until',clock_timestamp()+interval '6 hours') where auth_user_id=p_user;
 return true;
end $$;
revoke all on function public.bmb_claim_assessment(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bmb_claim_assessment(uuid,bigint,text) to service_role;
create function public.bmb_claim_due_account() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype;
begin
 select * into a from bmb_accounts where next_check_at<=clock_timestamp()
 and (coalesce((settings#>>'{grant,active}')::boolean,false) or coalesce((settings#>>'{notifications,enabled}')::boolean,false))
 order by next_check_at,auth_user_id for update skip locked limit 1;
 if not found then return null; end if;
 update bmb_accounts set next_check_at=clock_timestamp()+interval '5 minutes' where auth_user_id=a.auth_user_id;
 return to_jsonb(a);
end $$;
revoke all on function public.bmb_claim_due_account() from public,anon,authenticated;
grant execute on function public.bmb_claim_due_account() to service_role;
create table public.bmb_sessions (
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, started_at timestamptz not null, ended_at timestamptz,
 pause_started_at timestamptz, pause_ended_at timestamptz,
 ended_reason text, entry_mode text, observed_at timestamptz not null,
 primary key(auth_user_id,id), check(ended_at is null or ended_at>=started_at)
);
create index bmb_sessions_history on public.bmb_sessions(auth_user_id,started_at desc,id desc);
create function public.bmb_sync_sessions(p_user uuid,p_observed timestamptz,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_observed>clock_timestamp()+interval '30 seconds' or jsonb_array_length(p_rows)>2000 then raise exception 'bmb_invalid_observation'; end if;
 insert into bmb_sessions(auth_user_id,id,started_at,ended_at,pause_started_at,pause_ended_at,ended_reason,entry_mode,observed_at)
 select p_user,x.id,x.started_at,x.ended_at,x.pause_started_at,x.pause_ended_at,x.ended_reason,x.entry_mode,p_observed
 from jsonb_to_recordset(p_rows) as x(id uuid,started_at timestamptz,ended_at timestamptz,pause_started_at timestamptz,pause_ended_at timestamptz,ended_reason text,entry_mode text)
 on conflict(auth_user_id,id) do update set ended_at=excluded.ended_at,pause_started_at=excluded.pause_started_at,pause_ended_at=excluded.pause_ended_at,
 ended_reason=excluded.ended_reason,entry_mode=excluded.entry_mode,observed_at=excluded.observed_at
 where excluded.observed_at>bmb_sessions.observed_at and (bmb_sessions.ended_at is null or excluded.ended_at is not null);
end $$;
revoke all on function public.bmb_sync_sessions(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.bmb_sync_sessions(uuid,timestamptz,jsonb) to service_role;
create table public.bmb_device_signals (
 auth_user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 kind text not null check(kind='daily_limit_reached'), occurred_at timestamptz not null,
 threshold_minutes integer not null check(threshold_minutes between 5 and 1440),
 primary key(auth_user_id,id)
);
alter table public.bmb_device_signals enable row level security;
revoke all on public.bmb_device_signals from anon,authenticated;
grant all on public.bmb_device_signals to service_role;
create policy bmb_signals_service on public.bmb_device_signals for all to service_role using(true) with check(true);
create table public.bmb_events (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete cascade,
 event_key text not null, meaning_key text not null, kind text not null check(kind in ('action','notification')),
 initiative_key text not null,
 priority integer not null default 0, facts jsonb not null default '{}',
 grant_version bigint, action jsonb, expires_at timestamptz not null,
 outcome jsonb not null default '{}', feedback jsonb,
 created_at timestamptz not null default now(),
 unique(auth_user_id,event_key,kind), unique(auth_user_id,meaning_key,kind)
);
create index bmb_events_budget on public.bmb_events(auth_user_id,kind,created_at desc);
alter table public.bmb_accounts enable row level security;
alter table public.bmb_sessions enable row level security;
alter table public.bmb_events enable row level security;
revoke all on public.bmb_accounts, public.bmb_sessions, public.bmb_events from anon,authenticated;
grant all on public.bmb_accounts, public.bmb_sessions, public.bmb_events to service_role;
create policy bmb_accounts_service on public.bmb_accounts for all to service_role using(true) with check(true);
create policy bmb_sessions_service on public.bmb_sessions for all to service_role using(true) with check(true);
create policy bmb_events_service on public.bmb_events for all to service_role using(true) with check(true);

create function public.bmb_save_settings(p_user uuid,p_install text,p_settings jsonb,p_version bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('bmb:'||p_user::text,0));
 if not exists(select 1 from blankmind_identity_links where auth_user_id=p_user and app_install_id=p_install) then raise exception 'bmb_installation_mismatch'; end if;
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 if coalesce(a.version,0)<>p_version then return jsonb_build_object('saved',false,'reason','version_conflict'); end if;
 insert into bmb_accounts(auth_user_id,app_install_id,settings,version) values(p_user,p_install,p_settings,p_version+1)
 on conflict(auth_user_id) do update set settings=excluded.settings,app_install_id=excluded.app_install_id,version=excluded.version,updated_at=now();
 return jsonb_build_object('saved',true,'version',p_version+1);
end $$;

create function public.bmb_claim_event(p_user uuid,p_event jsonb,p_version bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype; limits jsonb; n timestamptz:=clock_timestamp(); localday date; localminute int; s int; e int; event_id uuid; root text; daycap int; weekcap int;
begin
 perform pg_advisory_xact_lock(hashtextextended('bmb:'||p_user::text,0));
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 if not found or a.version<>p_version or not exists(select 1 from blankmind_identity_links where auth_user_id=p_user and app_install_id=a.app_install_id) then return jsonb_build_object('claimed',false,'reason','grant_changed_or_installation'); end if;
 if (p_event->>'expires_at')::timestamptz<=n or coalesce((a.settings->>'paused_until')::timestamptz,'epoch')>n then return jsonb_build_object('claimed',false,'reason','expired_or_paused'); end if;
 limits:=a.settings->case when p_event->>'kind'='action' then 'grant' else 'notifications' end;
 if p_event->>'kind'='action' then
   if not coalesce((limits->>'active')::boolean,false) or (limits->>'expires_at')::timestamptz<=n or not (limits->'action_types' ? (p_event#>>'{action,type}'))
      or coalesce((p_event#>>'{action,hard_mode}')::boolean,false) or coalesce((p_event#>>'{action,minutes}')::int,0)>(limits->>'max_minutes')::int
      or p_event#>>'{action,type}' not in ('start_protection','set_daily_limit','enable_adult_filter')
      or (p_event#>>'{action,type}' in ('start_protection','set_daily_limit') and coalesce((p_event#>>'{action,minutes}')::int,0)<5) then return jsonb_build_object('claimed',false,'reason','outside_grant'); end if;
   if exists(select 1 from bmb_events where auth_user_id=p_user and kind='action' and created_at>n-make_interval(mins=>(limits->>'min_interval_minutes')::int)) then return jsonb_build_object('claimed',false,'reason','minimum_interval'); end if;
 else
   if not coalesce((limits->>'enabled')::boolean,false) then return jsonb_build_object('claimed',false,'reason','notifications_disabled'); end if;
 end if;
 localday:=(n at time zone (a.settings->>'timezone'))::date;
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
 return jsonb_build_object('claimed',event_id is not null,'id',event_id,'reason',case when event_id is null then 'duplicate' else 'reserved' end);
end $$;

-- The existing channel inbox remains the sole device action authority.
create function public.bmb_enqueue_event(p_user uuid,p_id uuid,p_action jsonb)
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

-- Transport and native receipt writes must merge under a row lock. A late push
-- result cannot erase execution evidence or replace a terminal status.
create function public.bmb_merge_outcome(p_user uuid,p_id uuid,p_patch jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare ev bmb_events%rowtype;
begin
 select * into ev from bmb_events where auth_user_id=p_user and id=p_id for update;
 if not found then raise exception 'bmb_receipt_not_found'; end if;
 if p_patch ? 'status' and ev.outcome ? 'status' and ev.outcome->>'status'<>p_patch->>'status' then raise exception 'bmb_receipt_conflict'; end if;
 update bmb_events set outcome=outcome||p_patch where id=p_id;
end $$;
revoke all on function public.bmb_merge_outcome(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bmb_merge_outcome(uuid,uuid,jsonb) to service_role;
