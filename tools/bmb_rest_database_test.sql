begin;
insert into auth.users(id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into blankmind_identity_links values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','rest-install-C'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd','rest-install-D');
do $$
declare u uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; snap jsonb; r jsonb; observed timestamptz:=clock_timestamp(); c int; test_experiment_id uuid:=gen_random_uuid(); prefs jsonb; version_now bigint;
begin
 select jsonb_build_object('schema_version',1,'objective','improve_apple_watch_measured_sleep','observed_at',observed,'timezone','UTC',
   'nights',jsonb_agg(jsonb_build_object('date',((now() at time zone 'UTC')::date-i),
     'start_at',(((now() at time zone 'UTC')::date-i)::timestamp at time zone 'UTC')-interval '1 hour',
     'end_at',(((now() at time zone 'UTC')::date-i)::timestamp at time zone 'UTC')+interval '7 hours',
     'source','apple_watch','source_bundle','Watch','manual',false,'complete',true,'sleep_minutes',440,'awake_minutes',40)),
   'checkins','[]'::jsonb,'protection_intervals','[]'::jsonb,'health_context',null,'digital',jsonb_build_object('available',false,'rows','[]'::jsonb))
 into snap from generate_series(1,14) i;
 r:=bmb_sync_rest(u,'rest-install-C',snap);
 if not (r->>'synced')::boolean then raise exception 'Rest snapshot was not synced'; end if;
 select count(*) into c from bmb_rest_nights where auth_user_id=u;
 if c<>14 then raise exception 'Watch nights missing %',c; end if;
 r:=bmb_sync_rest(u,'rest-install-C',snap);
 if not (r->>'stale')::boolean then raise exception 'Snapshot replay was not idempotent'; end if;
 begin
   perform bmb_sync_rest(u,'rest-install-D',snap);
   raise exception 'Foreign installation was allowed';
 exception when others then if sqlerrm<>'rest_installation_mismatch' then raise; end if; end;
 if (bmb_rest_global_prior(u)->>'available')::boolean then raise exception 'Pooling without consent'; end if;
 snap:=jsonb_set(jsonb_set(snap,'{observed_at}',to_jsonb(clock_timestamp())),'{health_context}','{"metrics":[{"id":"pulse","unit":"bpm","points":[]}]}');
 perform bmb_sync_rest(u,'rest-install-C',snap);
 if (select snapshot->'health_context' from bmb_rest_context where auth_user_id=u)<>'null' then raise exception 'Client-only consent uploaded broad Health'; end if;
 select version into version_now from bmb_accounts where auth_user_id=u;
 prefs:='{"timezone":"UTC","grant":{"active":false},"rest":{"health_context_shared":true}}';
 perform bmb_save_settings(u,'rest-install-C',prefs,version_now);
 snap:=jsonb_set(snap,'{observed_at}',to_jsonb(clock_timestamp()));
 perform bmb_sync_rest(u,'rest-install-C',snap);
 if (select snapshot#>>'{health_context,metrics,0,id}' from bmb_rest_context where auth_user_id=u)<>'pulse' then raise exception 'Explicit broad Health consent ignored'; end if;
 perform bmb_save_settings(u,'rest-install-C',jsonb_set(prefs,'{rest,health_context_shared}','false'),version_now+1);
 if (select snapshot->'health_context' from bmb_rest_context where auth_user_id=u)<>'null' then raise exception 'Broad Health withdrawal did not clear context atomically'; end if;
 insert into bmb_rest_experiments(id,auth_user_id,action_id,hypothesis,metric,review_after_days,action,baseline,evidence_ids)
 values(test_experiment_id,u,'app_rest-test','Test pre-sleep protection','sleep_continuity',14,'{"weekdays":[2,3,4,5,6]}','[]','[]');
 perform bmb_rest_execution('dddddddd-dddd-4ddd-8ddd-dddddddddddd','app_rest-test','verified','{"valid":true}');
 if (select status from bmb_rest_experiments where id=test_experiment_id and auth_user_id=u limit 1)<>'awaiting_execution' then raise exception 'Cross-account receipt accepted'; end if;
 perform bmb_rest_execution(u,'app_rest-test','verified','{"valid":true}');
 if not exists(select 1 from bmb_rest_experiments where auth_user_id=u and status='active' and verified_at is not null) then raise exception 'Verified action was not activated'; end if;
 perform bmb_rest_execution(u,'app_rest-test','failed','{}');
 if not exists(select 1 from bmb_rest_experiments where auth_user_id=u and status='active') then raise exception 'Late receipt overwrote verified execution'; end if;
 begin
   perform bmb_finish_rest_experiment(u,test_experiment_id,'{"objective":"improve_apple_watch_measured_sleep","status":"improved","intervention_count":2,"evidence_ids":[],"causal":false}');
   raise exception 'Insufficient evidence certified sleep';
 exception when others then if sqlerrm<>'rest_invalid_evaluation' then raise; end if; end;
 perform bmb_revoke_rest(u);
 if exists(select 1 from bmb_rest_nights where auth_user_id=u) or exists(select 1 from bmb_rest_context where auth_user_id=u) then raise exception 'Revocation retained personal Health'; end if;
 if not exists(select 1 from bmb_rest_experiments where auth_user_id=u and status='forgotten' and baseline='[]' and evaluation is null) then raise exception 'Revocation retained experiment evidence'; end if;
end $$;
do $$
declare u uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; parent_id uuid:=gen_random_uuid(); window_id uuid:=gen_random_uuid();
 prefs jsonb; a jsonb; ev jsonb; r jsonb; current_version bigint; claimed_id uuid;
begin
 select version into current_version from bmb_accounts where auth_user_id=u;
 prefs:=jsonb_build_object('timezone','UTC','grant',jsonb_build_object('active',true,'action_types','["update_schedule"]'::jsonb,
   'start_minute',0,'end_minute',0,'max_minutes',30,'max_per_day',1,'max_per_week',3,'min_interval_minutes',15,'expires_at',now()+interval '1 day'),
   'rest','{"adjustments_enabled":true,"weekdays":[1,2,3,4,5,6,7],"start_minute":1260,"end_minute":480,"max_shift_minutes":15,"review_after_days":14}'::jsonb);
 perform bmb_save_settings(u,'rest-install-C',prefs,current_version);current_version:=current_version+1;
 insert into bmb_rest_context(auth_user_id,app_install_id,observed_at,snapshot) values(u,'rest-install-C',now(),jsonb_build_object('schedule',jsonb_build_object('windows',jsonb_build_array(
   jsonb_build_object('id',window_id,'enabled',true,'start_minute',1350,'end_minute',420,'weekdays','[1,2,3,4,5,6,7]'::jsonb,'recurrence','continuous','timezone','UTC')))));
 insert into bmb_rest_nights(auth_user_id,date,start_at,end_at,timezone,source,source_bundle,manual,complete,sleep_minutes,awake_minutes,observed_at)
 select u,(now() at time zone 'UTC')::date-i,now()-make_interval(days=>i)-interval '8 hours',now()-make_interval(days=>i),
   'UTC','apple_watch','Watch',false,true,440,40,now() from generate_series(1,14) i;
 insert into bmb_rest_experiments(id,auth_user_id,action_id,hypothesis,metric,review_after_days,action,baseline,evidence_ids,status,verified_at,evaluation)
 values(parent_id,u,'app_'||window_id::text,'Test a stable pre-sleep window','sleep_continuity',14,'{}','[]','[]','completed',now()-interval '15 days','{"status":"unchanged","delta":0,"evidence_ids":["measured-outcome"]}');
 a:=jsonb_build_object('type','update_schedule','window_id',window_id,'start_minute',1335,'end_minute',420,'weekdays','[1,2,3,4,5,6,7]'::jsonb,
   'recurrence','continuous','timezone','UTC','hard_mode',false);
 ev:=jsonb_build_object('event_key','rest-iteration','meaning_key','rest-iteration','kind','action','action',a,'expires_at',now()+interval '30 minutes',
   'facts',jsonb_build_object('source','measured_rest_iteration','experiment_id',parent_id,'authorized_adjustment',a));
 r:=bmb_claim_event(u,ev||jsonb_build_object('action',a||'{"start_minute":1320}'::jsonb),current_version);
 if (r->>'claimed')::boolean then raise exception 'Model changed the authorized adjustment'; end if;
 r:=bmb_claim_event(u,ev,current_version);claimed_id:=(r->>'id')::uuid;
 if not (r->>'claimed')::boolean then raise exception 'Measured rest adjustment denied %',r; end if;
 if not exists(select 1 from bmb_rest_experiments where auth_user_id=u and action_id='bmb_'||claimed_id::text and status='awaiting_execution' and jsonb_array_length(baseline)=14) then raise exception 'Next experiment did not freeze its measured baseline'; end if;
 a:=a||jsonb_build_object('id','bmb_'||claimed_id::text,'expires_at',now()+interval '30 minutes','autonomous',true,'grant_version',current_version);
 r:=bmb_enqueue_event(u,claimed_id,a);
 if not (r->>'enqueued')::boolean then raise exception 'Rest adjustment did not reach the canonical inbox %',r; end if;
 r:=bmb_save_settings(u,'rest-install-C',jsonb_set(prefs,'{grant,active}','false'),current_version);
 if (bmb_enqueue_event(u,claimed_id,a)->>'enqueued')::boolean then raise exception 'Revoked rest adjustment was enqueued'; end if;
end $$;
-- The aggregate must not count the requesting user, non-consenting users or a
-- different lead-time cohort toward the twenty-other-users privacy boundary.
do $$
declare requester uuid:=gen_random_uuid(); contributor uuid; twentieth uuid; r jsonb; i int;
begin
 insert into auth.users(id) values(requester);
 insert into bmb_accounts(auth_user_id,app_install_id,settings) values(requester,'rest-pool-requester','{"rest":{"global_learning_enabled":true}}');
 insert into bmb_rest_experiments(auth_user_id,action_id,hypothesis,metric,review_after_days,action,baseline,evidence_ids,status,evaluation,lead_minutes_bucket)
 values(requester,'own-outcome','Private hypothesis','sleep_continuity',14,'{}','[]','[]','completed','{"status":"improved","delta":99}',30);
 for i in 1..20 loop
   contributor:=gen_random_uuid(); twentieth:=contributor;
   insert into auth.users(id) values(contributor);
   insert into bmb_accounts(auth_user_id,app_install_id,settings) values(contributor,'rest-pool-'||i,jsonb_build_object('rest',jsonb_build_object('global_learning_enabled',i<20)));
   insert into bmb_rest_experiments(auth_user_id,action_id,hypothesis,metric,review_after_days,action,baseline,evidence_ids,status,evaluation,lead_minutes_bucket)
   values(contributor,'measured-outcome','Private hypothesis','sleep_continuity',14,'{}','[]','[]','completed','{"status":"improved","delta":4}',30);
 end loop;
 r:=bmb_rest_global_prior(requester);
 if (r->>'available')::boolean then raise exception 'Own or non-consenting outcome crossed the twenty-other-users boundary'; end if;
 update bmb_accounts set settings='{"rest":{"global_learning_enabled":true}}' where auth_user_id=twentieth;
 r:=bmb_rest_global_prior(requester);
 if not (r->>'available')::boolean or (r#>>'{rows,0,users}')::int<>20 or (r#>>'{rows,0,mean_delta}')::numeric<>4
 or r::text like '%'||twentieth::text||'%' or r::text like '%Private hypothesis%' then raise exception 'Aggregate leaked personal evidence or computed the wrong prior %',r; end if;
 update bmb_rest_experiments set lead_minutes_bucket=45 where auth_user_id=twentieth;
 if (bmb_rest_global_prior(requester)->>'available')::boolean then raise exception 'Different plan cohorts were combined'; end if;
 update bmb_rest_experiments set lead_minutes_bucket=30 where auth_user_id=twentieth;
 update bmb_accounts set settings='{"rest":{"global_learning_enabled":false}}' where auth_user_id=twentieth;
 if (bmb_rest_global_prior(requester)->>'available')::boolean then raise exception 'Withdrawn contributor remained pooled'; end if;
 update bmb_accounts set settings='{"rest":{"global_learning_enabled":false}}' where auth_user_id=requester;
 if bmb_rest_global_prior(requester)->>'reason'<>'global_learning_not_enabled' then raise exception 'Requester withdrawal failed'; end if;
end $$;
do $$ begin
 if has_table_privilege('authenticated','public.bmb_rest_nights','SELECT') or has_table_privilege('anon','public.bmb_rest_context','SELECT')
 or has_function_privilege('authenticated','public.bmb_rest_global_prior(uuid)','EXECUTE') then raise exception 'Client bypassed server-only rest access'; end if;
end $$;
rollback;
