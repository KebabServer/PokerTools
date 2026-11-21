create table public.pokertools_members (
  user_id uuid primary key references auth.users (id) on delete cascade
);

insert into public.pokertools_members (user_id)
select id from auth.users where email_confirmed_at is not null and not is_anonymous;

alter table public.pokertools_members enable row level security;
revoke all on public.pokertools_members from public, anon, authenticated;
grant select on public.pokertools_members to authenticated;
create policy "Accounts can check their own membership" on public.pokertools_members
  for select to authenticated using ((select auth.uid()) = user_id);

-- Restrictive policies keep the existing ownership and read-only policies in force.
do $$
declare
  relation text;
begin
  foreach relation in array array['study_files', 'flop_viewer_spots', 'saved_hands', 'saved_calculations', 'saved_notes']
  loop
    execute format($policy$
      create policy "PokerTools members only" on public.%I
      as restrictive for all to authenticated
      using ((select exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))))
      with check ((select exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))))
    $policy$, relation);
  end loop;
end;
$$;
