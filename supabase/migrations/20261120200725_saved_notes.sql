create table public.saved_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '',
  updated_at timestamptz not null default now()
);

create index saved_notes_owner_updated_idx on public.saved_notes (owner_id, updated_at desc, id desc);

alter table public.saved_notes enable row level security;
revoke all on public.saved_notes from public, anon, authenticated;
grant select, delete on public.saved_notes to authenticated;
grant insert (id, owner_id, title, body), update (title, body) on public.saved_notes to authenticated;

create policy "Owners can read notes" on public.saved_notes
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can save notes" on public.saved_notes
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update notes" on public.saved_notes
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete notes" on public.saved_notes
  for delete to authenticated using ((select auth.uid()) = owner_id);

create function public.set_saved_note_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

revoke execute on function public.set_saved_note_updated_at() from public, anon, authenticated;

create trigger saved_notes_updated_at
before update on public.saved_notes
for each row execute function public.set_saved_note_updated_at();
