-- Minimal identity table in the disposable CI database only.
create extension if not exists pgcrypto;
create table public.blankmind_identity_links(auth_user_id uuid primary key references auth.users(id),app_install_id text not null);
