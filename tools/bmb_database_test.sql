begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into blankmind_identity_links values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','install-A'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','install-B');
do $$
declare u uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; r jsonb; prefs jsonb; ev jsonb; action jsonb; event_id uuid; key text;
begin
 prefs:=jsonb_build_object('timezone','UTC','grant',jsonb_build_object('active',true,'action_types',jsonb_build_array('start_protection'),
   'start_minute',0,'end_minute',0,'max_minutes',30,'max_per_day',1,'max_per_week',3,'min_interval_minutes',15,'expires_at',now()+interval '1 day'),
   'notifications',jsonb_build_object('enabled',true,'start_minute',0,'end_minute',0,'max_per_day',1,'max_per_week',3));
 r:=bmb_save_settings(u,'install-A',prefs,0);
 if not (r->>'saved')::boolean then raise exception 'Initial grant failed'; end if;
 if (bmb_save_settings(u,'install-A',prefs,0)->>'saved')::boolean then raise exception 'Settings CAS bypass'; end if;
 action:='{"type":"start_protection","minutes":30,"hard_mode":false}'::jsonb;
 ev:=jsonb_build_object('event_key','event-A','meaning_key','meaning-A','kind','action','action',action,'facts','{}'::jsonb,'expires_at',now()+interval '30 minutes');
 r:=bmb_claim_event(u,ev,1); event_id:=(r->>'id')::uuid;
 if not (r->>'claimed')::boolean then raise exception 'Authorized event denied %',r; end if;
 if (bmb_claim_event(u,ev,1)->>'claimed')::boolean then raise exception 'Action replay consumed twice'; end if;
 if (bmb_claim_event(u,ev||'{"event_key":"another","meaning_key":"another"}',1)->>'claimed')::boolean then raise exception 'Frequency bypass'; end if;
 key:='assistant:'||substr(encode(digest('app:'||u::text,'sha256'),'hex'),1,32);
 insert into assistant_semantic_conversations(anonymous_user_id,channel,state,storage_version,updated_at,expires_at)
 values(key,'whatsapp','{"semantic_state":{"schema_version":1}}',1,now(),now()+interval '2 hours');
 action:=action||jsonb_build_object('id','bmb_'||event_id::text,'status','queued','expires_at',now()+interval '30 minutes','autonomous',true,'grant_version',1);
 r:=bmb_enqueue_event(u,event_id,action);
 if not (r->>'enqueued')::boolean then raise exception 'Native inbox queue failed %',r; end if;
 if not (bmb_enqueue_event(u,event_id,action)->>'duplicate')::boolean then raise exception 'Enqueue replay not identical'; end if;
 if not exists(select 1 from digital_wellness_feature_payloads where anonymous_user_id=key and payload#>>'{properties,memory,pending_assistant_action,id}'='bmb_'||event_id::text) then raise exception 'Wrong canonical inbox'; end if;
 if (select storage_version from assistant_semantic_conversations where anonymous_user_id=key)<>2 then raise exception 'Concurrent reactive turn not invalidated'; end if;
 perform bmb_merge_outcome(u,event_id,'{"status":"verified","device_evidence":{"result":"native_verified"}}');
 perform bmb_merge_outcome(u,event_id,'{"transport":{"sent":true}}');
 if (select outcome->>'status' from bmb_events where id=event_id)<>'verified' then raise exception 'Late push erased receipt'; end if;
 begin
  perform bmb_merge_outcome(u,event_id,'{"status":"failed"}');
  raise exception 'Terminal receipt overwritten';
 exception when others then if sqlerrm<>'bmb_receipt_conflict' then raise; end if; end;
 if (bmb_enqueue_event('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',event_id,action)->>'enqueued')::boolean then raise exception 'Cross-account enqueue'; end if;
 r:=bmb_save_settings(u,'install-A',jsonb_set(prefs,'{grant,active}','false'),1);
 if not (r->>'saved')::boolean then raise exception 'Revocation failed'; end if;
 if (bmb_enqueue_event(u,event_id,action)->>'enqueued')::boolean then raise exception 'Revocation not current'; end if;
 if (bmb_claim_event(u,ev||'{"event_key":"after-revoke","meaning_key":"after-revoke"}',1)->>'claimed')::boolean then raise exception 'Stale grant allowed'; end if;
 ev:=ev||jsonb_build_object('kind','notification','event_key','notice-A','meaning_key','receipt:'||event_id::text,'facts',jsonb_build_object('source','native_receipt','event_id',event_id));
 if not (bmb_claim_event(u,ev,2)->>'claimed')::boolean then raise exception 'Separate notification permission coupled to grant'; end if;
 if (bmb_claim_event(u,ev||'{"event_key":"notice-B","meaning_key":"notice-B"}',2)->>'claimed')::boolean then raise exception 'Notification day budget bypass'; end if;
 perform bmb_sync_sessions(u,now(),'[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","started_at":"2026-01-01T10:00:00Z","ended_at":"2026-01-01T10:30:00Z","ended_reason":"timer"}]');
 perform bmb_sync_sessions(u,now()-interval '1 minute','[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","started_at":"2026-01-01T10:00:00Z","ended_at":null}]');
 if (select ended_at from bmb_sessions where auth_user_id=u and id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') is null then raise exception 'Stale session resurrected'; end if;
 if not bmb_claim_assessment(u,2,'silent-opportunity') or bmb_claim_assessment(u,2,'silent-opportunity') then raise exception 'Provider assessment replay'; end if;
 if has_table_privilege('authenticated','bmb_accounts','UPDATE') or has_function_privilege('authenticated','bmb_claim_event(uuid,jsonb,bigint)','EXECUTE') then raise exception 'Public service access'; end if;
end $$;
rollback;
