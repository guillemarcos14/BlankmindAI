-- Keep 022 intact: it may already be installed. App turns are resumable jobs.
alter table public.assistant_app_turns
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists prepared_payload jsonb,
  add column if not exists action_status text,
  add column if not exists action_enqueued_at timestamptz;

create index if not exists assistant_app_turns_history_idx
  on public.assistant_app_turns(auth_user_id, created_at desc, id desc);

create or replace function public.claim_assistant_app_turn(
  p_auth_user_id uuid, p_turn_id uuid, p_user_text text, p_lease_owner uuid
)
returns table(claimed boolean, status text, turn jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  current_row public.assistant_app_turns%rowtype;
begin
  if p_auth_user_id is null or p_turn_id is null or p_lease_owner is null
    or p_user_text is null or char_length(p_user_text) not between 1 and 4000 then
    return query select false, 'invalid'::text, null::jsonb;
    return;
  end if;
  -- Serialize claims for one account, even when the UUIDs differ.
  perform pg_advisory_xact_lock(hashtextextended('assistant-app:' || p_auth_user_id::text, 0));
  select * into current_row from public.assistant_app_turns t where t.id = p_turn_id for update;
  if found then
    if current_row.auth_user_id <> p_auth_user_id or current_row.user_text <> p_user_text then
      return query select false, 'payload_conflict'::text, null::jsonb;
      return;
    end if;
    if current_row.status = 'completed' then
      return query select false, 'completed'::text, to_jsonb(current_row);
      return;
    end if;
    if current_row.status = 'processing' and current_row.lease_expires_at > now() then
      return query select false, 'processing'::text, to_jsonb(current_row);
      return;
    end if;
  end if;
  if exists (select 1 from public.assistant_app_turns t
      where t.auth_user_id = p_auth_user_id and t.id <> p_turn_id
        and t.status = 'processing' and t.lease_expires_at > now()) then
    return query select false, 'conversation_in_progress'::text, null::jsonb;
    return;
  end if;
  insert into public.assistant_app_turns as t
    (id, auth_user_id, user_text, status, lease_owner, lease_expires_at)
  values (p_turn_id, p_auth_user_id, p_user_text, 'processing', p_lease_owner, now() + interval '90 seconds')
  on conflict (id) do update set status = 'processing', lease_owner = excluded.lease_owner,
    lease_expires_at = excluded.lease_expires_at
  where t.auth_user_id = p_auth_user_id and t.user_text = p_user_text
  returning * into current_row;
  if not found then
    return query select false, 'payload_conflict'::text, null::jsonb;
    return;
  end if;
  return query select true, 'claimed'::text, to_jsonb(current_row);
end;
$$;

create or replace function public.prepare_assistant_app_turn(
  p_auth_user_id uuid, p_turn_id uuid, p_lease_owner uuid,
  p_anonymous_user_id text, p_expected_version bigint, p_state jsonb, p_payload jsonb
)
returns table(prepared boolean, status text, turn jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  current_row public.assistant_app_turns%rowtype;
  semantic_result record;
begin
  select * into current_row from public.assistant_app_turns t
    where t.id = p_turn_id and t.auth_user_id = p_auth_user_id for update;
  if not found or current_row.status <> 'processing' or current_row.lease_owner is distinct from p_lease_owner
      or current_row.lease_expires_at <= now() then
    return query select false, 'lease_lost'::text, null::jsonb;
    return;
  end if;
  if current_row.prepared_payload is not null then
    return query select true, 'prepared'::text, to_jsonb(current_row);
    return;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
      or octet_length(p_payload::text) > 65536
      or coalesce(char_length(p_payload ->> 'assistant_text'), 0) not between 1 and 4000 then
    return query select false, 'invalid'::text, null::jsonb;
    return;
  end if;
  -- One transaction commits shared BM memory and the exact reply/action. A lost
  -- HTTP response can then resume without another model call or semantic write.
  select * into semantic_result from public.commit_assistant_semantic_conversation(
    p_anonymous_user_id, 'whatsapp', p_expected_version, p_state, 7200);
  if semantic_result.committed is not true then
    return query select false, semantic_result.status::text, null::jsonb;
    return;
  end if;
  update public.assistant_app_turns t set prepared_payload = p_payload || jsonb_build_object('semantic_identity', p_anonymous_user_id),
    lease_expires_at = now() + interval '90 seconds'
    where t.id = p_turn_id returning * into current_row;
  return query select true, 'prepared'::text, to_jsonb(current_row);
end;
$$;

create or replace function public.enqueue_assistant_app_action(
  p_auth_user_id uuid, p_turn_id uuid, p_lease_owner uuid
)
returns table(enqueued boolean, status text, action jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  current_row public.assistant_app_turns%rowtype;
  memory_version bigint;
  pending jsonb;
  memory_key text;
  invalidates boolean;
begin
  select * into current_row from public.assistant_app_turns t
    where t.id = p_turn_id and t.auth_user_id = p_auth_user_id for update;
  if not found or current_row.status <> 'processing' or current_row.lease_owner is distinct from p_lease_owner
      or current_row.lease_expires_at <= now() then
    return query select false, 'lease_lost'::text, null::jsonb;
    return;
  end if;
  pending := current_row.prepared_payload -> 'action';
  memory_key := current_row.prepared_payload ->> 'semantic_identity';
  invalidates := coalesce((current_row.prepared_payload ->> 'invalidates')::boolean, false);
  if (pending is null or jsonb_typeof(pending) <> 'object') and not invalidates then
    return query select false, 'invalid'::text, null::jsonb;
    return;
  end if;
  if jsonb_typeof(pending) = 'object' and pending ->> 'id' is distinct from 'app_' || p_turn_id::text then
    return query select false, 'invalid'::text, null::jsonb;
    return;
  end if;
  if jsonb_typeof(pending) = 'object' and current_row.action_status in ('verified', 'delayed', 'failed', 'dismissed', 'expired', 'superseded') then
    return query select false, current_row.action_status, pending || jsonb_build_object('status', current_row.action_status);
    return;
  end if;
  -- The same row lock is used by WhatsApp's semantic CAS. Its next turn cannot
  -- slip between this version check and appending the pending-action event.
  select c.storage_version into memory_version from public.assistant_semantic_conversations c
    where c.anonymous_user_id = memory_key for update;
  if not found or memory_version is distinct from (current_row.prepared_payload ->> 'semantic_version')::bigint then
    return query select false, 'superseded'::text, pending || '{"status":"superseded"}'::jsonb;
    return;
  end if;
  if jsonb_typeof(pending) = 'object' and (pending ->> 'expires_at')::timestamptz <= clock_timestamp() then
    return query select false, 'expired'::text, pending || '{"status":"expired"}'::jsonb;
    return;
  end if;
  if current_row.action_enqueued_at is not null then
    return query select true, 'duplicate'::text, pending;
    return;
  end if;
  insert into public.digital_wellness_feature_payloads (
    anonymous_user_id, schema_version, payload, insight, platform, locale, app_version,
    build_number, data_consent, consent_text, privacy_raw_health_samples_sent,
    privacy_raw_sleep_stage_timestamps_sent, privacy_exact_app_selection_sent,
    privacy_exact_location_sent, submitted_at
  ) values (
    memory_key, 1, jsonb_build_object('event', 'assistant_memory_updated', 'properties',
      jsonb_build_object('channel', 'whatsapp', 'memory', jsonb_build_object('pending_assistant_action', pending),
        'source', 'assistant_action_pending')),
    '{"event":"assistant_memory_updated"}'::jsonb, 'whatsapp', '', '', '', true,
    'Assistant personal memory from user-provided chat data', false, false, false, false, clock_timestamp()
  );
  update public.assistant_app_turns t set action_id = pending ->> 'id', action_enqueued_at = clock_timestamp()
    where t.id = p_turn_id;
  return query select true, case when jsonb_typeof(pending) = 'object' then 'queued' else 'invalidated' end, pending;
end;
$$;

-- Provider turns must obey the same semantic lock as app actions. A delayed WA
-- or SMS worker cannot enqueue or clear an action after a newer app turn won.
create or replace function public.enqueue_assistant_channel_action(
  p_anonymous_user_id text, p_channel text, p_expected_version bigint, p_action jsonb
)
returns table(enqueued boolean, status text)
language plpgsql security definer set search_path = public
as $$
declare
  memory_version bigint;
begin
  if p_anonymous_user_id is null or p_anonymous_user_id !~ '^assistant:[a-f0-9]{32}$'
      or p_channel is null or p_channel not in ('whatsapp', 'sms')
      or p_expected_version is null or p_expected_version < 1
      or (p_action is not null and p_action <> 'null'::jsonb
        and (jsonb_typeof(p_action) <> 'object' or coalesce(char_length(p_action ->> 'id'), 0) not between 1 and 160
          or octet_length(p_action::text) > 65536)) then
    return query select false, 'invalid'::text;
    return;
  end if;
  select c.storage_version into memory_version from public.assistant_semantic_conversations c
    where c.anonymous_user_id = p_anonymous_user_id and c.channel = p_channel for update;
  if not found or memory_version is distinct from p_expected_version then
    return query select false, 'superseded'::text;
    return;
  end if;
  insert into public.digital_wellness_feature_payloads (
    anonymous_user_id, schema_version, payload, insight, platform, locale, app_version,
    build_number, data_consent, consent_text, privacy_raw_health_samples_sent,
    privacy_raw_sleep_stage_timestamps_sent, privacy_exact_app_selection_sent,
    privacy_exact_location_sent, submitted_at
  ) values (
    p_anonymous_user_id, 1, jsonb_build_object('event', 'assistant_memory_updated', 'properties',
      jsonb_build_object('channel', p_channel, 'memory', jsonb_build_object('pending_assistant_action', p_action),
        'source', 'assistant_action_pending')),
    '{"event":"assistant_memory_updated"}'::jsonb, p_channel, '', '', '', true,
    'Assistant personal memory from user-provided chat data', false, false, false, false, clock_timestamp()
  );
  return query select true, case when jsonb_typeof(p_action) = 'object' then 'queued' else 'invalidated' end;
end;
$$;

revoke all on function public.enqueue_assistant_channel_action(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_assistant_channel_action(text, text, bigint, jsonb) to service_role;

create index if not exists assistant_pending_event_idx
  on public.digital_wellness_feature_payloads(anonymous_user_id, submitted_at desc, id desc)
  where (payload -> 'properties' -> 'memory') ? 'pending_assistant_action';

create or replace function public.transition_assistant_pending_action(
  p_anonymous_user_id text, p_channel text, p_expected_action_id text, p_expected_status text,
  p_action jsonb, p_outcome jsonb, p_expected_version bigint default null
)
returns table(updated boolean, status text)
language plpgsql security definer set search_path = public
as $$
declare
  current_pending jsonb;
  memory_version bigint;
  matches boolean;
  patch jsonb := '{}'::jsonb;
  transition_status text;
begin
  if p_anonymous_user_id is null or p_anonymous_user_id !~ '^assistant:[a-f0-9]{32}$'
      or p_channel is null or p_channel not in ('whatsapp', 'sms')
      or (p_action is not null and p_action <> 'null'::jsonb and jsonb_typeof(p_action) <> 'object')
      or (p_outcome is not null and p_outcome <> 'null'::jsonb
        and (jsonb_typeof(p_outcome) <> 'object' or p_outcome ->> 'id' is distinct from p_expected_action_id))
      or coalesce(octet_length(p_action::text), 0) + coalesce(octet_length(p_outcome::text), 0) > 65536 then
    return query select false, 'invalid'::text;
    return;
  end if;
  -- Onboarding and installed clients may have an inbox before their first BM turn.
  insert into public.assistant_semantic_conversations(anonymous_user_id, channel)
    values (p_anonymous_user_id, p_channel) on conflict (anonymous_user_id) do nothing;
  select c.storage_version into memory_version from public.assistant_semantic_conversations c
    where c.anonymous_user_id = p_anonymous_user_id and c.channel = p_channel for update;
  if not found then
    return query select false, 'invalid'::text;
    return;
  end if;
  select e.payload #> '{properties,memory,pending_assistant_action}' into current_pending
    from public.digital_wellness_feature_payloads e where e.anonymous_user_id = p_anonymous_user_id
      and (e.payload -> 'properties' -> 'memory') ? 'pending_assistant_action'
    order by e.submitted_at desc, e.id desc limit 1;
  matches := (current_pending ->> 'id') is not distinct from p_expected_action_id
    and (case when jsonb_typeof(current_pending) = 'object' then coalesce(current_pending ->> 'status', 'queued') end)
      is not distinct from p_expected_status
    and (p_expected_version is null or p_expected_version = memory_version);
  transition_status := case when matches then 'updated'
    when (current_pending ->> 'id') is not distinct from p_expected_action_id
      and (p_expected_version is null or p_expected_version = memory_version) then 'status_changed' else 'superseded' end;
  if matches then patch := jsonb_build_object('pending_assistant_action', p_action); end if;
  -- A late terminal receipt is still evidence for A, but must never clear or
  -- resurrect B. Its append-only outcome survives even when the inbox moved on.
  if jsonb_typeof(p_outcome) = 'object' and transition_status <> 'status_changed' then
    patch := patch || jsonb_build_object('last_assistant_action_outcome', p_outcome);
  end if;
  if patch <> '{}'::jsonb then
    insert into public.digital_wellness_feature_payloads (
      anonymous_user_id, schema_version, payload, insight, platform, locale, app_version,
      build_number, data_consent, consent_text, privacy_raw_health_samples_sent,
      privacy_raw_sleep_stage_timestamps_sent, privacy_exact_app_selection_sent,
      privacy_exact_location_sent, submitted_at
    ) values (
      p_anonymous_user_id, 1, jsonb_build_object('event', 'assistant_memory_updated', 'properties',
        jsonb_build_object('channel', p_channel, 'memory', patch, 'source', 'assistant_action_transition')),
      '{"event":"assistant_memory_updated"}'::jsonb, p_channel, '', '', '', true,
      'Assistant personal memory from user-provided chat data', false, false, false, false, clock_timestamp()
    );
  end if;
  return query select matches, transition_status;
end;
$$;
revoke all on function public.transition_assistant_pending_action(text, text, text, text, jsonb, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.transition_assistant_pending_action(text, text, text, text, jsonb, jsonb, bigint) to service_role;

create or replace function public.invalidate_assistant_channel_generation(
  p_anonymous_user_id text, p_channel text, p_expected_version bigint
)
returns table(updated boolean, status text)
language plpgsql security definer set search_path = public
as $$
declare
  memory_version bigint;
  current_pending jsonb;
  cleared record;
begin
  if p_anonymous_user_id is null or p_anonymous_user_id !~ '^assistant:[a-f0-9]{32}$'
      or p_channel is null or p_channel not in ('whatsapp', 'sms')
      or p_expected_version is null or p_expected_version < 0 then
    return query select false, 'invalid'::text;
    return;
  end if;
  insert into public.assistant_semantic_conversations(anonymous_user_id, channel)
    values (p_anonymous_user_id, p_channel) on conflict (anonymous_user_id) do nothing;
  select c.storage_version into memory_version from public.assistant_semantic_conversations c
    where c.anonymous_user_id = p_anonymous_user_id and c.channel = p_channel for update;
  if not found or memory_version is distinct from p_expected_version then
    return query select false, 'superseded'::text;
    return;
  end if;
  -- STOP / changing a legacy connection cancels this generation, including a
  -- prepared action whose enqueue has not arrived yet. Newer turns are preserved.
  update public.assistant_semantic_conversations c set storage_version = c.storage_version + 1,
    state = '{}'::jsonb, updated_at = clock_timestamp(), expires_at = clock_timestamp()
    where c.anonymous_user_id = p_anonymous_user_id;
  select e.payload #> '{properties,memory,pending_assistant_action}' into current_pending
    from public.digital_wellness_feature_payloads e where e.anonymous_user_id = p_anonymous_user_id
      and (e.payload -> 'properties' -> 'memory') ? 'pending_assistant_action'
    order by e.submitted_at desc, e.id desc limit 1;
  select * into cleared from public.transition_assistant_pending_action(p_anonymous_user_id, p_channel,
    current_pending ->> 'id', case when jsonb_typeof(current_pending) = 'object' then coalesce(current_pending ->> 'status', 'queued') end,
    null, null);
  if not cleared.updated then raise exception 'assistant_generation_clear_failed'; end if;
  return query select true, 'updated'::text;
end;
$$;
revoke all on function public.invalidate_assistant_channel_generation(text, text, bigint) from public, anon, authenticated;
grant execute on function public.invalidate_assistant_channel_generation(text, text, bigint) to service_role;

revoke all on function public.claim_assistant_app_turn(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.prepare_assistant_app_turn(uuid, uuid, uuid, text, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_assistant_app_action(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_assistant_app_turn(uuid, uuid, text, uuid) to service_role;
grant execute on function public.prepare_assistant_app_turn(uuid, uuid, uuid, text, bigint, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_assistant_app_action(uuid, uuid, uuid) to service_role;
