begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','reply','completed',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test','reply','completed',now());
do $$
declare r record; i integer;
begin
  if has_table_privilege('authenticated','assistant_voice_requests','select')
    or has_function_privilege('authenticated','reserve_assistant_voice(uuid,uuid,uuid)','execute') then
    raise exception 'voice grants exposed';
  end if;
  select * into r from reserve_assistant_voice('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',gen_random_uuid());
  if r.reserved or r.reason <> 'unavailable' then raise exception 'cross-account speech reserved'; end if;
  select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if not r.reserved then raise exception 'valid reservation rejected'; end if;
  select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if r.reserved or r.reason <> 'duplicate' then raise exception 'request replay regenerated'; end if;
  for i in 1..19 loop
    select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',gen_random_uuid());
    if not r.reserved then raise exception 'early quota at %',i; end if;
  end loop;
  select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',gen_random_uuid());
  if r.reserved or r.reason <> 'rate_limited' then raise exception 'hourly budget bypassed'; end if;
  delete from assistant_app_turns where id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  if (select count(*) from assistant_voice_requests where auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and turn_id is null) <> 20 then
    raise exception 'turn deletion reset personal budget';
  end if;
  insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','reply','completed',now());
  select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',gen_random_uuid());
  if r.reserved or r.reason <> 'rate_limited' then raise exception 'turn deletion bypassed hourly budget'; end if;
  update assistant_voice_requests set created_at=now()-interval '2 hours';
  insert into assistant_voice_requests select gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid,now()-interval '2 hours' from generate_series(1,80);
  select * into r from reserve_assistant_voice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',gen_random_uuid());
  if r.reserved then raise exception 'daily user budget bypassed'; end if;
  insert into assistant_voice_global_usage(hour,requests) values(date_trunc('hour',now()-interval '2 hours'),1000)
    on conflict(hour) do update set requests=1000;
  select * into r from reserve_assistant_voice('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-000000000001',gen_random_uuid());
  if r.reserved then raise exception 'global budget bypassed'; end if;
  delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if exists(select 1 from assistant_voice_requests where auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'account deletion left usage records';
  end if;
  select * into r from reserve_assistant_voice('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-000000000001',gen_random_uuid());
  if r.reserved then raise exception 'account deletion reset global budget'; end if;
end;
$$;
rollback;
