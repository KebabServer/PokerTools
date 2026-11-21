alter table public.saved_notes
  add column pinned boolean not null default false,
  drop constraint saved_notes_title_check,
  add constraint saved_notes_title_check check (char_length(btrim(title)) <= 120);

grant insert (pinned), update (pinned) on public.saved_notes to authenticated;

create policy "PokerTools owners can receive note notifications"
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'pokertools-notes:' || (select auth.uid())::text
    and topic = (select realtime.topic())
    and exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))
  );

create schema if not exists private;
create function private.notify_saved_note_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'pokertools-notes:' || coalesce(new.owner_id, old.owner_id)::text, true);
  return null;
end;
$$;
revoke execute on function private.notify_saved_note_change() from public, anon, authenticated;

create trigger saved_notes_notify_change
after insert or update or delete on public.saved_notes
for each row execute function private.notify_saved_note_change();
