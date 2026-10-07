-- Keep the global budget independent of account/turn deletion, without keeping
-- personal identifiers. Include the partially elapsed oldest hour, so the
-- rolling budget is conservative rather than allowing a boundary burst.
create table if not exists public.assistant_voice_global_usage (
  hour timestamptz primary key,
  requests integer not null check (requests >= 0)
);
alter table public.assistant_voice_global_usage enable row level security;
revoke all on public.assistant_voice_global_usage from public, anon, authenticated;
grant select on public.assistant_voice_global_usage to service_role;
insert into public.assistant_voice_global_usage(hour,requests)
  select date_trunc('hour',created_at),count(*)::integer from public.assistant_voice_requests
  where created_at >= now()-interval '25 hours' group by 1
  on conflict(hour) do nothing;

create or replace function public.reserve_assistant_voice(
  p_auth_user_id uuid, p_turn_id uuid, p_request_id uuid
) returns table(reserved boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz;
begin
  perform pg_advisory_xact_lock(1791384106);
  v_now := clock_timestamp();
  if exists (select 1 from assistant_voice_requests where request_id = p_request_id) then
    return query select false, 'duplicate'::text; return;
  end if;
  if not exists (select 1 from assistant_app_turns where id = p_turn_id
    and auth_user_id = p_auth_user_id and status = 'completed') then
    return query select false, 'unavailable'::text; return;
  end if;
  if (select count(*) from assistant_voice_requests where auth_user_id = p_auth_user_id
    and created_at > v_now - interval '1 hour') >= 20
    or (select count(*) from assistant_voice_requests where auth_user_id = p_auth_user_id
    and created_at > v_now - interval '24 hours') >= 100
    or (select coalesce(sum(requests),0) from assistant_voice_global_usage
    where hour >= date_trunc('hour',v_now - interval '24 hours')) >= 1000 then
    return query select false, 'rate_limited'::text; return;
  end if;
  insert into assistant_voice_requests(request_id, auth_user_id, turn_id)
    values(p_request_id, p_auth_user_id, p_turn_id);
  insert into assistant_voice_global_usage(hour,requests) values(date_trunc('hour',v_now),1)
    on conflict(hour) do update set requests=assistant_voice_global_usage.requests+1;
  delete from assistant_voice_global_usage where hour < v_now - interval '48 hours';
  return query select true, 'reserved'::text;
end;
$$;
revoke all on function public.reserve_assistant_voice(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_assistant_voice(uuid, uuid, uuid) to service_role;
