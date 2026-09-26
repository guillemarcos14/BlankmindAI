-- Only run in a disposable test database. This bootstraps the Supabase roles
-- and minimal auth schema required by migrations 003, 015, 022 and 023.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
