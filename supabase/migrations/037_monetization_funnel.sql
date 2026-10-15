-- Commercial access is independent of model/consent/Screen Time authority.
create table public.funnel_accounts (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 free_window_id uuid, initial_implemented_at timestamptz, first_completed_at timestamptz,
 registration_receipt jsonb, diagnosis jsonb, created_at timestamptz not null default now()
);
create table public.funnel_storekit_grants (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 original_transaction_id text unique not null, transaction_id text not null,
 product_id text not null, environment text not null check(environment in ('Production','Sandbox')),
 expires_at timestamptz not null, checked_at timestamptz not null default now()
);
create table public.funnel_diagnoses (
 token_hash text primary key, context jsonb not null,
 expires_at timestamptz not null default now()+interval '24 hours',
 claimed_by uuid references auth.users(id) on delete cascade
);
alter table public.funnel_accounts enable row level security;
alter table public.funnel_storekit_grants enable row level security;
alter table public.funnel_diagnoses enable row level security;
revoke all on public.funnel_accounts,public.funnel_storekit_grants,public.funnel_diagnoses from public,anon,authenticated;
grant all on public.funnel_accounts,public.funnel_storekit_grants,public.funnel_diagnoses to service_role;
create policy funnel_accounts_service on public.funnel_accounts for all to service_role using(true) with check(true);
create policy funnel_grants_service on public.funnel_storekit_grants for all to service_role using(true) with check(true);
create policy funnel_diagnoses_service on public.funnel_diagnoses for all to service_role using(true) with check(true);
create function public.funnel_implement_first(p_user uuid,p_window uuid,p_receipt jsonb) returns void
language sql security definer set search_path=public as $$
 insert into funnel_accounts(auth_user_id,free_window_id,initial_implemented_at,registration_receipt)
 values(p_user,p_window,now(),p_receipt) on conflict(auth_user_id) do update set
 free_window_id=coalesce(funnel_accounts.free_window_id,excluded.free_window_id),
 initial_implemented_at=coalesce(funnel_accounts.initial_implemented_at,excluded.initial_implemented_at),registration_receipt=excluded.registration_receipt;
$$;
create function public.funnel_claim_diagnosis(p_user uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d public.funnel_diagnoses%rowtype;
begin
 select * into d from funnel_diagnoses where token_hash=p_hash for update;
 if not found or d.expires_at<=now() or (d.claimed_by is not null and d.claimed_by<>p_user) then return null; end if;
 update funnel_diagnoses set claimed_by=p_user where token_hash=p_hash;
 return d.context;
end; $$;
revoke all on function public.funnel_implement_first(uuid,uuid,jsonb),public.funnel_claim_diagnosis(uuid,text) from public,anon,authenticated;
grant execute on function public.funnel_implement_first(uuid,uuid,jsonb),public.funnel_claim_diagnosis(uuid,text) to service_role;
