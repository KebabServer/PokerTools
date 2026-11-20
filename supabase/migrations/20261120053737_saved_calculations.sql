create table public.saved_calculations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  input jsonb not null check (
    jsonb_typeof(input) = 'object'
    and input ?& array['players', 'board', 'dead']
    and jsonb_typeof(input->'players') = 'array'
    and jsonb_typeof(input->'board') = 'string'
    and jsonb_typeof(input->'dead') = 'string'
  ),
  result jsonb not null check (
    jsonb_typeof(result) = 'object'
    and result ?& array['mode', 'count', 'players']
    and result->>'mode' in ('exact', 'estimated')
    and jsonb_typeof(result->'count') = 'number'
    and jsonb_typeof(result->'players') = 'array'
  ),
  created_at timestamptz not null default now()
);

create index saved_calculations_owner_created_idx on public.saved_calculations (owner_id, created_at desc);

alter table public.saved_calculations enable row level security;
revoke all on public.saved_calculations from public, anon, authenticated;
grant select, insert, delete on public.saved_calculations to authenticated;

create policy "Owners can read calculations" on public.saved_calculations
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can save calculations" on public.saved_calculations
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can delete calculations" on public.saved_calculations
  for delete to authenticated using ((select auth.uid()) = owner_id);
