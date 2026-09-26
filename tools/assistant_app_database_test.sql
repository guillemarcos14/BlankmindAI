-- Run after the disposable setup and migrations 003, 015, 022, 023. Every fixture
-- and mutation below is rolled back. Never point the setup at production.
begin;
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('99999999-9999-4999-8999-999999999999');

do $$
declare
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  other_id uuid := '99999999-9999-4999-8999-999999999999';
  turn_id uuid := '22222222-2222-4222-8222-222222222222';
  second_id uuid := '33333333-3333-4333-8333-333333333333';
  lease_id uuid := '44444444-4444-4444-8444-444444444444';
  retry_lease uuid := '55555555-5555-4555-8555-555555555555';
  memory_key text := 'assistant:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  state jsonb := '{"semantic_state":{"intent":"block","status":"ready"},"last_assistant_message":"Ready, not verified."}';
  payload jsonb := jsonb_build_object('assistant_text', 'Ready, not verified.', 'semantic_version', 1,
    'action', jsonb_build_object('id', 'app_22222222-2222-4222-8222-222222222222', 'minutes', 45,
      'expires_at', now() + interval '45 minutes'));
  result record;
  version bigint;
  cancel_turn uuid := '66666666-6666-4666-8666-666666666666';
  cancel_payload jsonb := '{"assistant_text":"Cancelled.","semantic_version":2,"action":null,"invalidates":true}';
begin
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Focus', lease_id);
  assert result.claimed and result.status = 'claimed', 'first claim fails';
  assert result.turn ->> 'lease_owner' = lease_id::text, 'lease owner not saved';
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Focus', retry_lease);
  assert not result.claimed and result.status = 'processing', 'same UUID can execute twice';
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Changed text', retry_lease);
  assert not result.claimed and result.status = 'payload_conflict' and result.turn is null, 'UUID payload is mutable';
  select * into result from public.claim_assistant_app_turn(other_id, turn_id, 'Focus', retry_lease);
  assert not result.claimed and result.status = 'payload_conflict' and result.turn is null, 'turn leaks across users';
  select * into result from public.claim_assistant_app_turn(owner_id, second_id, 'Another', retry_lease);
  assert not result.claimed and result.status = 'conversation_in_progress', 'parallel account turns accepted';
  select * into result from public.claim_assistant_app_turn(other_id, second_id, 'Another', retry_lease);
  assert result.claimed, 'another account is incorrectly locked';

  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, retry_lease, memory_key, 0, state, payload);
  assert not result.prepared and result.status = 'lease_lost', 'wrong worker can prepare';
  select * into result from public.prepare_assistant_app_turn(other_id, turn_id, lease_id, memory_key, 0, state, payload);
  assert not result.prepared and result.turn is null, 'wrong user can prepare';
  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 2, state, payload);
  assert not result.prepared and result.status = 'conflict', 'stale semantic state accepted';
  assert (select prepared_payload is null from public.assistant_app_turns where id = turn_id), 'CAS conflict stored a checkpoint';
  -- A failure after semantic CAS must roll back both parts of prepare.
  alter table public.assistant_app_turns add constraint test_reject_checkpoint check (prepared_payload is null);
  begin
    perform public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 0, state, payload);
    raise exception 'checkpoint failure was not injected';
  exception when check_violation then null;
  end;
  assert (select storage_version = 0 from public.assistant_semantic_conversations where anonymous_user_id = memory_key), 'failed checkpoint committed memory';
  alter table public.assistant_app_turns drop constraint test_reject_checkpoint;
  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 0, state, payload);
  assert result.prepared and result.turn -> 'prepared_payload' @> payload, 'checkpoint not saved';
  select storage_version into version from public.assistant_semantic_conversations where anonymous_user_id = memory_key;
  assert version = 1, 'semantic state not committed exactly once';
  assert (select c.state ->> 'last_assistant_message' = 'Ready, not verified.'
    from public.assistant_semantic_conversations c where c.anonymous_user_id = memory_key), 'visible and semantic text diverged';
  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 0, state, payload);
  assert result.prepared, 'lost prepare HTTP response cannot recover';
  assert (select storage_version = 1 from public.assistant_semantic_conversations where anonymous_user_id = memory_key), 'retry duplicated memory';

  select * into result from public.enqueue_assistant_app_action(other_id, turn_id, lease_id);
  assert not result.enqueued and result.action is null, 'another user can enqueue';
  select * into result from public.enqueue_assistant_app_action(owner_id, turn_id, retry_lease);
  assert not result.enqueued and result.status = 'lease_lost', 'another worker can enqueue';
  -- Simulate a WhatsApp CAS that won between the JS memory read and SQL enqueue.
  update public.assistant_semantic_conversations set storage_version = 2 where anonymous_user_id = memory_key;
  select * into result from public.enqueue_assistant_app_action(owner_id, turn_id, lease_id);
  assert not result.enqueued and result.status = 'superseded', 'stale enqueue crossed semantic CAS';
  assert (select count(*) = 0 from public.digital_wellness_feature_payloads), 'stale enqueue emitted an action';
  update public.assistant_semantic_conversations set storage_version = 1 where anonymous_user_id = memory_key;
  select * into result from public.enqueue_assistant_app_action(owner_id, turn_id, lease_id);
  assert result.enqueued and result.status = 'queued', 'valid queue failed';
  assert (select action_id = 'app_' || turn_id::text and action_enqueued_at is not null
    from public.assistant_app_turns where id = turn_id), 'queue did not checkpoint action identity';
  select * into result from public.enqueue_assistant_app_action(owner_id, turn_id, lease_id);
  assert result.enqueued and result.status = 'duplicate', 'durable queue dedup failed';
  assert (select count(*) = 1 from public.digital_wellness_feature_payloads), 'retry duplicated pending event';

  update public.assistant_app_turns set lease_expires_at = now() - interval '1 second' where id = turn_id;
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Focus', retry_lease);
  assert result.claimed and result.turn -> 'prepared_payload' @> payload, 'stale worker cannot recover checkpoint';
  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 1, state, payload);
  assert not result.prepared and result.status = 'lease_lost', 'old worker retained ownership';
  update public.assistant_app_turns set status = 'failed', lease_expires_at = null where id = turn_id;
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Focus', lease_id);
  assert result.claimed and result.turn -> 'prepared_payload' @> payload, 'failed turn cannot resume exact action';
  update public.assistant_app_turns set status = 'completed', assistant_text = 'Ready, not verified.',
    completed_at = now(), prepared_payload = null, lease_expires_at = null where id = turn_id;
  select * into result from public.claim_assistant_app_turn(owner_id, turn_id, 'Focus', retry_lease);
  assert not result.claimed and result.status = 'completed', 'completed UUID was re-executed';

  select * into result from public.claim_assistant_app_turn(owner_id, cancel_turn, 'Cancel', lease_id);
  assert result.claimed, 'cancellation could not claim';
  select * into result from public.prepare_assistant_app_turn(owner_id, cancel_turn, lease_id, memory_key, 1, state, cancel_payload);
  assert result.prepared, 'cancellation could not checkpoint';
  update public.assistant_semantic_conversations set storage_version = 3 where anonymous_user_id = memory_key;
  select * into result from public.enqueue_assistant_app_action(owner_id, cancel_turn, lease_id);
  assert not result.enqueued and result.status = 'superseded', 'stale cancellation could clear newer WA action';
  assert (select count(*) = 1 from public.digital_wellness_feature_payloads), 'stale cancellation wrote memory';
  update public.assistant_semantic_conversations set storage_version = 2 where anonymous_user_id = memory_key;
  select * into result from public.enqueue_assistant_app_action(owner_id, cancel_turn, lease_id);
  assert result.enqueued and result.status = 'invalidated', 'valid cancellation did not clear action';
  assert (select count(*) = 1 from public.digital_wellness_feature_payloads e
    where e.payload #> '{properties,memory,pending_assistant_action}' = 'null'::jsonb), 'cancellation event is malformed';
  select * into result from public.enqueue_assistant_app_action(owner_id, cancel_turn, lease_id);
  assert result.status = 'duplicate', 'cancellation retried non-idempotently';
  assert (select count(*) = 2 from public.digital_wellness_feature_payloads), 'duplicate cancellation appended event';

  assert not has_table_privilege('anon', 'public.assistant_app_turns', 'select'), 'anon table read granted';
  assert not has_table_privilege('authenticated', 'public.assistant_app_turns', 'select'), 'client table read granted';
  assert not has_function_privilege('anon', 'public.claim_assistant_app_turn(uuid,uuid,text,uuid)', 'execute'), 'anon claim allowed';
  assert not has_function_privilege('authenticated', 'public.prepare_assistant_app_turn(uuid,uuid,uuid,text,bigint,jsonb,jsonb)', 'execute'), 'client prepare allowed';
  assert not has_function_privilege('authenticated', 'public.enqueue_assistant_app_action(uuid,uuid,uuid)', 'execute'), 'client enqueue allowed';
  assert has_function_privilege('service_role', 'public.claim_assistant_app_turn(uuid,uuid,text,uuid)', 'execute'), 'server claim grant missing';
  assert (select relrowsecurity from pg_class where oid = 'public.assistant_app_turns'::regclass), 'RLS disabled';
  raise notice 'assistant app SQL: isolation, immutable payload, account lease, CAS, atomic checkpoint, retry recovery, stale owner and grants passed';
end;
$$;
do $$
declare
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  app_turn uuid := '77777777-7777-4777-8777-777777777777';
  cancel_turn uuid := '88888888-8888-4888-8888-888888888888';
  lease_id uuid := '44444444-4444-4444-8444-444444444444';
  memory_key text := 'assistant:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  state jsonb := '{"semantic_state":{"intent":"block","status":"ready"}}';
  pending jsonb := jsonb_build_object('id', 'wa_earlier', 'minutes', 5, 'expires_at', now() + interval '30 minutes');
  app_payload jsonb := jsonb_build_object('assistant_text', 'App request ready.', 'semantic_version', 2,
    'action', jsonb_build_object('id', 'app_77777777-7777-4777-8777-777777777777', 'minutes', 45,
      'expires_at', now() + interval '30 minutes'));
  result record;
  event_count bigint;
begin
  update public.assistant_app_turns set status = 'completed', lease_expires_at = null,
    assistant_text = coalesce(assistant_text, 'Complete.'), completed_at = now() where auth_user_id = owner_id;
  -- WA commits v1 then pauses. The app commits and enqueues v2 before WA resumes.
  perform public.commit_assistant_semantic_conversation(memory_key, 'whatsapp', 0, state, 7200);
  perform public.claim_assistant_app_turn(owner_id, app_turn, 'App focus', lease_id);
  select * into result from public.prepare_assistant_app_turn(owner_id, app_turn, lease_id, memory_key, 1, state, app_payload);
  assert result.prepared, 'app v2 could not prepare';
  select * into result from public.enqueue_assistant_app_action(owner_id, app_turn, lease_id);
  assert result.enqueued, 'app v2 could not queue';
  select count(*) into event_count from public.digital_wellness_feature_payloads;
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 1, pending);
  assert not result.enqueued and result.status = 'superseded', 'late WA replaced newer app pending';
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 1, null);
  assert not result.enqueued and result.status = 'superseded', 'late WA cleared newer app pending';
  assert (select count(*) = event_count from public.digital_wellness_feature_payloads), 'late WA wrote an event';

  -- The app now cancels at v3. Neither the old WA action nor its cleanup may revive it.
  update public.assistant_app_turns set status = 'completed', lease_expires_at = null,
    assistant_text = 'App request ready.', completed_at = now() where id = app_turn;
  perform public.claim_assistant_app_turn(owner_id, cancel_turn, 'Cancel app focus', lease_id);
  perform public.prepare_assistant_app_turn(owner_id, cancel_turn, lease_id, memory_key, 2, state,
    '{"assistant_text":"Cancelled.","semantic_version":3,"action":null,"invalidates":true}'::jsonb);
  select * into result from public.enqueue_assistant_app_action(owner_id, cancel_turn, lease_id);
  assert result.enqueued and result.status = 'invalidated', 'app v3 cancellation failed';
  select count(*) into event_count from public.digital_wellness_feature_payloads;
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 1, pending);
  assert not result.enqueued and result.status = 'superseded', 'late WA revived app cancellation';
  assert (select count(*) = event_count from public.digital_wellness_feature_payloads), 'cancelled app was overwritten';

  -- A genuinely newer provider turn remains usable. The old app retry is rejected.
  perform public.commit_assistant_semantic_conversation(memory_key, 'whatsapp', 3, state, 7200);
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 4, pending);
  assert result.enqueued and result.status = 'queued', 'current WA action rejected';
  select count(*) into event_count from public.digital_wellness_feature_payloads;
  select * into result from public.enqueue_assistant_app_action(owner_id, cancel_turn, lease_id);
  assert not result.enqueued and result.status = 'superseded', 'old app retry cleared current WA';
  assert (select count(*) = event_count from public.digital_wellness_feature_payloads), 'old app retry wrote an event';
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'sms', 4, pending);
  assert not result.enqueued, 'RPC crossed channel identity';
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 4, null);
  assert result.enqueued and result.status = 'invalidated', 'current WA cancellation rejected';
  assert not has_function_privilege('anon', 'public.enqueue_assistant_channel_action(text,text,bigint,jsonb)', 'execute'), 'anon channel enqueue allowed';
  assert not has_function_privilege('authenticated', 'public.enqueue_assistant_channel_action(text,text,bigint,jsonb)', 'execute'), 'client channel enqueue allowed';
  assert has_function_privilege('service_role', 'public.enqueue_assistant_channel_action(text,text,bigint,jsonb)', 'execute'), 'server channel enqueue grant missing';
  raise notice 'assistant action SQL: bidirectional WA/app queue and cancellation interleavings, identity and grants passed';
end;
$$;
do $$
declare
  memory_key text := 'assistant:cccccccccccccccccccccccccccccccc';
  a jsonb := '{"id":"wa_A","type":"delete_schedule","status":"queued"}';
  b jsonb := '{"id":"wa_B","type":"delete_schedule","status":"queued"}';
  result record;
  current_pending jsonb;
  event_count bigint;
begin
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', null, null, a, null, 0);
  assert result.updated, 'first onboarding/legacy inbox CAS failed';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'queued', a || '{"status":"delivered"}', null);
  assert result.updated, 'delivery CAS failed';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'delivered', a || '{"status":"confirmed"}', null);
  assert result.updated, 'confirmation CAS failed';
  select count(*) into event_count from public.digital_wellness_feature_payloads;
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'queued', a || '{"status":"delivered"}', null);
  assert not result.updated and result.status = 'status_changed', 'late poll demoted confirmed state';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'queued', null, '{"id":"wa_A","status":"failed"}');
  assert not result.updated and result.status = 'status_changed', 'late expiry cleared confirmed state';
  assert (select count(*) = event_count from public.digital_wellness_feature_payloads), 'stale same-action status wrote an outcome';

  -- A lifecycle reader saw A. A newer turn installs B before that reader writes.
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'confirmed', b, null);
  assert result.updated, 'new B action could not replace A';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'confirmed', a || '{"status":"execution_started"}', null);
  assert not result.updated and result.status = 'superseded', 'late nonterminal ack revived A';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', 'wa_A', 'confirmed', null, '{"id":"wa_A","status":"failed"}');
  assert not result.updated and result.status = 'superseded', 'late terminal ack cleared B';
  select e.payload #> '{properties,memory,pending_assistant_action}' into current_pending
    from public.digital_wellness_feature_payloads e where e.anonymous_user_id = memory_key
      and (e.payload -> 'properties' -> 'memory') ? 'pending_assistant_action'
    order by e.submitted_at desc, e.id desc limit 1;
  assert current_pending ->> 'id' = 'wa_B', 'B was erased by late receipt';
  assert exists(select 1 from public.digital_wellness_feature_payloads e where e.anonymous_user_id = memory_key
    and e.payload #>> '{properties,memory,last_assistant_action_outcome,id}' = 'wa_A'), 'late A receipt was lost';
  select * into result from public.transition_assistant_pending_action(memory_key, 'whatsapp', null, null, a, null, 0);
  assert not result.updated, 'stale onboarding overwrote B';
  select * into result from public.transition_assistant_pending_action(memory_key, 'sms', 'wa_B', 'queued', null, null);
  assert not result.updated and result.status = 'invalid', 'lifecycle crossed channel identity';
  assert not has_function_privilege('anon', 'public.transition_assistant_pending_action(text,text,text,text,jsonb,jsonb,bigint)', 'execute'), 'anon lifecycle access';
  assert not has_function_privilege('authenticated', 'public.transition_assistant_pending_action(text,text,text,text,jsonb,jsonb,bigint)', 'execute'), 'client lifecycle access';
  assert has_function_privilege('service_role', 'public.transition_assistant_pending_action(text,text,text,text,jsonb,jsonb,bigint)', 'execute'), 'server lifecycle grant missing';
  raise notice 'pending lifecycle SQL: stale poll, ack, expiry, onboarding and late receipts cannot erase or resurrect another action';
end;
$$;
do $$
declare
  memory_key text := 'assistant:dddddddddddddddddddddddddddddddd';
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  turn_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  lease_id uuid := '44444444-4444-4444-8444-444444444444';
  state jsonb := '{"semantic_state":{"intent":"block","status":"ready"}}';
  payload jsonb := jsonb_build_object('assistant_text', 'Prepared before STOP.', 'semantic_version', 2,
    'action', jsonb_build_object('id', 'app_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'minutes', 5,
      'expires_at', now() + interval '30 minutes'));
  pending jsonb := '{"id":"wa_late","status":"queued"}';
  result record;
begin
  update public.assistant_app_turns set status = 'completed', lease_expires_at = null,
    assistant_text = coalesce(assistant_text, 'Complete.'), completed_at = now() where auth_user_id = owner_id;
  perform public.commit_assistant_semantic_conversation(memory_key, 'whatsapp', 0, state, 7200);
  perform public.claim_assistant_app_turn(owner_id, turn_id, 'Prepare then stop', lease_id);
  select * into result from public.prepare_assistant_app_turn(owner_id, turn_id, lease_id, memory_key, 1, state, payload);
  assert result.prepared, 'pre-STOP app prepare failed';
  -- The inbox is still empty, but a v2 app action already exists off the inbox.
  select * into result from public.invalidate_assistant_channel_generation(memory_key, 'whatsapp', 2);
  assert result.updated, 'STOP failed with empty pending inbox';
  assert (select c.storage_version = 3 and c.state = '{}'::jsonb and c.expires_at <= clock_timestamp()
    from public.assistant_semantic_conversations c where c.anonymous_user_id = memory_key), 'STOP did not invalidate semantic generation';
  select * into result from public.enqueue_assistant_app_action(owner_id, turn_id, lease_id);
  assert not result.enqueued and result.status = 'superseded', 'prepared app enqueue revived after STOP';
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 2, pending);
  assert not result.enqueued and result.status = 'superseded', 'late WA enqueue revived after STOP';

  -- A new post-STOP intent remains usable; replaying the older STOP cannot erase B.
  perform public.commit_assistant_semantic_conversation(memory_key, 'whatsapp', 3, state, 7200);
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 4, pending);
  assert result.enqueued, 'fresh post-STOP intent could not enqueue';
  select * into result from public.invalidate_assistant_channel_generation(memory_key, 'whatsapp', 2);
  assert not result.updated and result.status = 'superseded', 'stale STOP invalidated a newer intent';
  assert (select storage_version = 4 from public.assistant_semantic_conversations where anonymous_user_id = memory_key), 'stale STOP changed generation';
  -- If a prepared enqueue wins just before STOP's lock, STOP clears that same generation too.
  select * into result from public.invalidate_assistant_channel_generation(memory_key, 'whatsapp', 4);
  assert result.updated, 'STOP could not clear action already queued in its generation';
  assert (select storage_version = 5 from public.assistant_semantic_conversations where anonymous_user_id = memory_key), 'STOP did not advance queued generation';
  select * into result from public.enqueue_assistant_channel_action(memory_key, 'whatsapp', 4, pending);
  assert not result.enqueued, 'same-generation enqueue revived after clearing';
  assert not has_function_privilege('anon', 'public.invalidate_assistant_channel_generation(text,text,bigint)', 'execute'), 'anon invalidation access';
  assert not has_function_privilege('authenticated', 'public.invalidate_assistant_channel_generation(text,text,bigint)', 'execute'), 'client invalidation access';
  assert has_function_privilege('service_role', 'public.invalidate_assistant_channel_generation(text,text,bigint)', 'execute'), 'server invalidation grant missing';
  raise notice 'STOP / identity generation SQL: prepared app and WA enqueue fenced; newer intents preserved';
end;
$$;
rollback;
