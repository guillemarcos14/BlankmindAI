-- Filter the deterministic cohort BEFORE LIMIT. Otherwise twenty unselected
-- oldest turns can permanently starve later selected turns at low percentages.
create function public.bm_jev_pending_sampled(p_users uuid[],p_since timestamptz,p_percent integer)
returns table(auth_user_id uuid,id uuid)
language sql security definer set search_path=public,extensions as $$
 select t.auth_user_id,t.id from assistant_app_turns t join auth.users u on u.id=t.auth_user_id
 left join bm_jev_turn_labels l on l.auth_user_id=t.auth_user_id and l.turn_id=t.id and l.taxonomy='blankmind-topics-1'
 cross join lateral (select digest(t.id::text,'sha256') as bytes) h
 where cardinality(p_users)<=20 and t.auth_user_id=any(p_users) and t.status='completed' and t.created_at>=p_since
 and p_since>=now()-interval '7 days' and p_percent between 1 and 100
 and mod(get_byte(h.bytes,0)::bigint*16777216+get_byte(h.bytes,1)::bigint*65536+get_byte(h.bytes,2)::bigint*256+get_byte(h.bytes,3),100)<p_percent
 and u.raw_app_meta_data->>'synthetic_staging_run' ~* '^[a-f0-9]{8}-[a-f0-9-]{27}$'
 and not exists(select 1 from bm_brain_memories m where m.auth_user_id=t.auth_user_id and m.value is null and m.source_at>=t.created_at)
 and (l.turn_id is null or (l.status in ('failed','processing') and l.attempts<2 and coalesce(l.lease_until,'-infinity')<=now() and coalesce(l.next_retry_at,'-infinity')<=now()))
 order by t.created_at,t.id limit 20;
$$;
revoke all on function public.bm_jev_pending_sampled(uuid[],timestamptz,integer) from public,anon,authenticated;
grant execute on function public.bm_jev_pending_sampled(uuid[],timestamptz,integer) to service_role;
