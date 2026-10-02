-- Durable personal facts are independent of expiring conversational state.
-- No client can choose another account or write model-generated memories.
create table if not exists public.bm_brain_memories (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key in ('name','goal','work_routine','bedtime','weak_moments','preferences','constraints','_reset')),
  value text check (value is null or length(value) between 1 and 400),
  source_text text,
  source_turn_id uuid,
  source_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (auth_user_id, key)
);
alter table public.bm_brain_memories enable row level security;
revoke all on public.bm_brain_memories from anon, authenticated;
grant select, insert, update, delete on public.bm_brain_memories to service_role;
create policy bm_brain_memories_service on public.bm_brain_memories for all to service_role using (true) with check (true);
alter table public.assistant_app_turns add column if not exists brain_memory_effect jsonb;
alter table public.assistant_app_turns add column if not exists brain_memory_applied_at timestamptz;
alter table public.assistant_app_turns add column if not exists auto_apply boolean not null default false;
alter table public.assistant_app_turns add column if not exists control_section text;

create or replace function public.commit_assistant_brain_memory(p_auth_user_id uuid, p_turn_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.assistant_app_turns%rowtype;
  effect jsonb;
  op text;
  memory_key text;
  memory_value text;
  evidence text;
  reset_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('brain-memory:' || p_auth_user_id::text, 0));
  select * into t from public.assistant_app_turns
    where auth_user_id=p_auth_user_id and id=p_turn_id for update;
  if not found or t.status <> 'completed' then return jsonb_build_object('committed',false); end if;
  if t.brain_memory_applied_at is not null then return jsonb_build_object('committed',true,'duplicate',true); end if;
  effect := t.brain_memory_effect;
  if effect is not null then
    op := effect->>'operation'; memory_key := effect->>'key';
    memory_value := effect->>'value'; evidence := effect->>'evidence';
    if op is null or op not in ('set','forget','forget_all') or evidence is null or length(trim(evidence))=0
        or strpos(t.user_text,evidence)=0
        or (op <> 'forget_all' and (memory_key is null or memory_key not in ('name','goal','work_routine','bedtime','weak_moments','preferences','constraints')))
        or (op='set' and (memory_value is null or length(trim(memory_value)) not between 1 and 400 or strpos(t.user_text,memory_value)=0))
      then raise exception 'invalid_brain_memory_evidence'; end if;
    if op='forget_all' then
      update public.bm_brain_memories set value=null, source_text=null, source_at=t.created_at,
        source_turn_id=t.id, updated_at=now() where auth_user_id=p_auth_user_id and source_at <= t.created_at;
      insert into public.bm_brain_memories(auth_user_id,key,value,source_text,source_turn_id,source_at)
        values(p_auth_user_id,'_reset',null,null,t.id,t.created_at)
        on conflict(auth_user_id,key) do update set value=null, source_text=null,
          source_turn_id=excluded.source_turn_id,source_at=excluded.source_at,updated_at=now()
          where bm_brain_memories.source_at <= excluded.source_at;
    else
      select source_at into reset_at from public.bm_brain_memories where auth_user_id=p_auth_user_id and key='_reset';
      if reset_at is null or reset_at < t.created_at then
        insert into public.bm_brain_memories(auth_user_id,key,value,source_text,source_turn_id,source_at)
          values(p_auth_user_id,memory_key,case when op='set' then memory_value end,
            case when op='set' then evidence end,t.id,t.created_at)
          on conflict(auth_user_id,key) do update set value=excluded.value,source_text=excluded.source_text,
            source_turn_id=excluded.source_turn_id,source_at=excluded.source_at,updated_at=now()
            where bm_brain_memories.source_at <= excluded.source_at;
      end if;
    end if;
  end if;
  update public.assistant_app_turns set brain_memory_applied_at=now()
    where auth_user_id=p_auth_user_id and id=p_turn_id;
  return jsonb_build_object('committed',true);
end $$;
revoke all on function public.commit_assistant_brain_memory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_assistant_brain_memory(uuid,uuid) to service_role;
