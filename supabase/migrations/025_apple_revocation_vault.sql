-- Keep Apple credentials encrypted at rest without expanding Lambda's global
-- environment. Clients must never be able to call this server-only reader.
create or replace function public.read_apple_revocation_configuration()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret::jsonb
  from vault.decrypted_secrets
  where name = 'blank_apple_revocation_configuration'
  limit 1;
$$;

revoke all on function public.read_apple_revocation_configuration() from public, anon, authenticated;
grant execute on function public.read_apple_revocation_configuration() to service_role;
