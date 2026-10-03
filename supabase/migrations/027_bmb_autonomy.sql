-- Prepared only. Apply with the coordinated backend/iOS release, never from evaluation.
create table public.bmb_accounts (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 app_install_id text not null,
 settings jsonb not null default '{}',
 version bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.bmb_accounts add column next_check_at timestamptz not null default now();
create function public.bmb_claim_due_account() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.bmb_accounts%rowtype;
begin
 select * into a from bmb_accounts where next_check_at<=clock_timestamp()
 and (coalesce((settings#>>'{grant,active}')::boolean,false) or coalesce((settings#>>'{notifications,enabled}')::boolean,false))
 order by next_check_at,auth_user_id for update skip locked limit 1;
 if not found then return null; end if;
 update bmb_accounts set next_check_at=clock_timestamp()+interval '30 minutes' where auth_user_id=a.auth_user_id;
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
declare a public.bmb_accounts%rowtype; limits jsonb; n timestamptz:=clock_timestamp(); localday date; localminute int; s int; e int; event_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('bmb:'||p_user::text,0));
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 if not found or a.version<>p_version or not exists(select 1 from blankmind_identity_links where auth_user_id=p_user and app_install_id=a.app_install_id) then return jsonb_build_object('claimed',false,'reason','grant_changed_or_installation'); end if;
 if (p_event->>'expires_at')::timestamptz<=n or coalesce((a.settings->>'paused_until')::timestamptz,'epoch')>n then return jsonb_build_object('claimed',false,'reason','expired_or_paused'); end if;
 limits:=a.settings->case when p_event->>'kind'='action' then 'grant' else 'notifications' end;
 if p_event->>'kind'='action' then
   if not coalesce((limits->>'active')::boolean,false) or (limits->>'expires_at')::timestamptz<=n or not (limits->'action_types' ? (p_event#>>'{action,type}'))
      or coalesce((p_event#>>'{action,hard_mode}')::boolean,false) or coalesce((p_event#>>'{action,minutes}')::int,0)>(limits->>'max_minutes')::int
      or p_event#>>'{action,type}'='apply_schedule' then return jsonb_build_object('claimed',false,'reason','outside_grant'); end if;
   if exists(select 1 from bmb_events where auth_user_id=p_user and kind='action' and created_at>n-make_interval(mins=>(limits->>'min_interval_minutes')::int)) then return jsonb_build_object('claimed',false,'reason','minimum_interval'); end if;
 else
   if not coalesce((limits->>'enabled')::boolean,false) then return jsonb_build_object('claimed',false,'reason','notifications_disabled'); end if;
 end if;
 localday:=(n at time zone (a.settings->>'timezone'))::date;
 localminute:=extract(hour from n at time zone (a.settings->>'timezone'))*60+extract(minute from n at time zone (a.settings->>'timezone'));
 s:=(limits->>'start_minute')::int; e:=(limits->>'end_minute')::int;
 if s<>e and not(case when s<e then localminute>=s and localminute<e else localminute>=s or localminute<e end) then return jsonb_build_object('claimed',false,'reason','quiet_hours'); end if;
 if (select count(*) from bmb_events where auth_user_id=p_user and kind=p_event->>'kind' and (created_at at time zone (a.settings->>'timezone'))::date=localday)>=(limits->>'max_per_day')::int
 or (select count(*) from bmb_events where auth_user_id=p_user and kind=p_event->>'kind' and created_at>n-interval '7 days')>=(limits->>'max_per_week')::int then return jsonb_build_object('claimed',false,'reason','budget'); end if;
 insert into bmb_events(auth_user_id,event_key,meaning_key,kind,priority,facts,grant_version,action,expires_at)
 values(p_user,p_event->>'event_key',p_event->>'meaning_key',p_event->>'kind',coalesce((p_event->>'priority')::int,0),p_event->'facts',p_version,p_event->'action',(p_event->>'expires_at')::timestamptz)
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
 perform 1 from assistant_semantic_conversations where anonymous_user_id=memory_key for update;
 select * into a from bmb_accounts where auth_user_id=p_user for update;
 select * into ev from bmb_events where auth_user_id=p_user and id=p_id and kind='action' for update;
 if not found or ev.grant_version<>a.version or ev.expires_at<=now() or not coalesce((a.settings#>>'{grant,active}')::boolean,false) then return jsonb_build_object('enqueued',false,'reason','revoked_or_expired'); end if;
 if p_action->>'id'<>'bmb_'||p_id::text or p_action->>'type'<>ev.action->>'type' then raise exception 'bmb_action_mismatch'; end if;
 if ev.outcome ? 'enqueued_at' then return jsonb_build_object('enqueued',true,'duplicate',true); end if;
 select payload#>'{properties,memory,pending_assistant_action}' into pending from digital_wellness_feature_payloads
 where anonymous_user_id=memory_key and (payload->'properties'->'memory') ? 'pending_assistant_action' order by submitted_at desc,id desc limit 1;
 if pending is not null and pending<>'null'::jsonb and (pending->>'expires_at')::timestamptz>now() and pending->>'status' not in ('verified','delayed','failed','dismissed','expired','superseded') then return jsonb_build_object('enqueued',false,'reason','inbox_busy'); end if;
 insert into digital_wellness_feature_payloads(anonymous_user_id,schema_version,payload,insight,platform,data_consent)
 values(memory_key,1,jsonb_build_object('event','assistant_memory_updated','properties',jsonb_build_object('channel','app','memory',jsonb_build_object('pending_assistant_action',p_action),'source','bmb_autonomous_action')),'{}','ios',true);
 update bmb_events set outcome=jsonb_build_object('enqueued_at',now()) where id=p_id;
 return jsonb_build_object('enqueued',true);
end $$;
revoke all on function public.bmb_save_settings(uuid,text,jsonb,bigint),public.bmb_claim_event(uuid,jsonb,bigint),public.bmb_enqueue_event(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bmb_save_settings(uuid,text,jsonb,bigint),public.bmb_claim_event(uuid,jsonb,bigint),public.bmb_enqueue_event(uuid,uuid,jsonb) to service_role;
