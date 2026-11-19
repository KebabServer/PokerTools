create table public.saved_hands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text not null default '',
  hand_data jsonb not null check (jsonb_typeof(hand_data) = 'object' and hand_data @> '{"version":1}'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_hands_owner_updated_idx on public.saved_hands (owner_id, updated_at desc);

alter table public.saved_hands enable row level security;
revoke all on public.saved_hands from public, anon, authenticated;
grant select, insert, update, delete on public.saved_hands to authenticated;

create policy "Owners can read hands" on public.saved_hands
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can save hands" on public.saved_hands
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update hands" on public.saved_hands
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete hands" on public.saved_hands
  for delete to authenticated using ((select auth.uid()) = owner_id);

create function public.set_saved_hand_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_saved_hand_updated_at() from public, anon, authenticated;

create trigger saved_hands_updated_at
before update on public.saved_hands
for each row execute function public.set_saved_hand_updated_at();
