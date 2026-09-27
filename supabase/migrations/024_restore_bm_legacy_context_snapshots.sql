-- Restore the schema shipped as 020 on the production release branch.
-- Other branches used 020 for waitlist channel openings. Keep both historical
-- migrations intact; this additive migration makes fresh installs reproducible.
create table if not exists public.bm_legacy_context_snapshots (
  connect_code text primary key,
  context jsonb not null default '{}',
  context_version bigint not null default 1,
  client_revision bigint not null default 0,
  source text not null default 'app',
  updated_at timestamptz not null default now()
);

alter table public.bm_legacy_context_snapshots enable row level security;
revoke all on public.bm_legacy_context_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.bm_legacy_context_snapshots to service_role;

create or replace function public.upsert_bm_legacy_user_context(
  p_connect_code text,
  p_context jsonb,
  p_source text default 'app'
) returns table(connect_code text, context_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(coalesce(p_connect_code, '')));
  incoming_client_revision bigint := 0;
begin
  if normalized_code = '' then
    raise exception 'bm_connect_code_missing';
  end if;

  if jsonb_typeof(p_context -> 'context_revision') = 'number' then
    incoming_client_revision := least(
      9223372036854775807::numeric,
      greatest(0::numeric, (p_context ->> 'context_revision')::numeric)
    )::bigint;
  end if;

  insert into public.bm_legacy_context_snapshots(
    connect_code,
    context,
    context_version,
    client_revision,
    source
  ) values (
    normalized_code,
    coalesce(p_context, '{}'::jsonb),
    1,
    incoming_client_revision,
    coalesce(nullif(trim(p_source), ''), 'app')
  )
  on conflict on constraint bm_legacy_context_snapshots_pkey do update
  set context = case
        when excluded.client_revision > bm_legacy_context_snapshots.client_revision
          or (excluded.client_revision = 0 and bm_legacy_context_snapshots.client_revision = 0)
        then excluded.context else bm_legacy_context_snapshots.context end,
      context_version = case
        when excluded.client_revision > bm_legacy_context_snapshots.client_revision
          or (excluded.client_revision = 0 and bm_legacy_context_snapshots.client_revision = 0)
        then bm_legacy_context_snapshots.context_version + 1 else bm_legacy_context_snapshots.context_version end,
      client_revision = greatest(excluded.client_revision, bm_legacy_context_snapshots.client_revision),
      source = case
        when excluded.client_revision > bm_legacy_context_snapshots.client_revision
          or (excluded.client_revision = 0 and bm_legacy_context_snapshots.client_revision = 0)
        then excluded.source else bm_legacy_context_snapshots.source end,
      updated_at = case
        when excluded.client_revision > bm_legacy_context_snapshots.client_revision
          or (excluded.client_revision = 0 and bm_legacy_context_snapshots.client_revision = 0)
        then now() else bm_legacy_context_snapshots.updated_at end;

  return query
  select snapshot.connect_code, snapshot.context_version
  from public.bm_legacy_context_snapshots snapshot
  where snapshot.connect_code = normalized_code;
end;
$$;

revoke all on function public.upsert_bm_legacy_user_context(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.upsert_bm_legacy_user_context(text, jsonb, text) to service_role;
