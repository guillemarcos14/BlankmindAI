-- Preserve the generated response language for later voice playback, independently
-- of device locale or the language of a later message. Legacy turns remain null.
alter table public.assistant_app_turns
  add column if not exists response_language text
  check (response_language in ('es', 'en'));
