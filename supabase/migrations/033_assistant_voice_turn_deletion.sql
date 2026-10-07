-- Deleting conversation content must not reset a live account's voice budget.
-- Keep only its content-free reservation, detach the deleted turn, and still
-- cascade every personal usage record when the account itself is deleted.
alter table public.assistant_voice_requests alter column turn_id drop not null;
alter table public.assistant_voice_requests drop constraint assistant_voice_requests_turn_id_fkey;
alter table public.assistant_voice_requests add constraint assistant_voice_requests_turn_id_fkey
  foreign key (turn_id) references public.assistant_app_turns(id) on delete set null;
