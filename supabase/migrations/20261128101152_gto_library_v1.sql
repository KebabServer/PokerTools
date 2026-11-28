create table public.gto_game_configs (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  variant text not null check (variant = 'nlhe'),
  seat_count smallint not null check (seat_count between 2 and 10),
  effective_stack integer not null,
  small_blind integer not null,
  big_blind integer not null,
  rake_basis_points smallint,
  rake_cap integer,
  check (0 < small_blind and small_blind < big_blind and big_blind < effective_stack),
  check ((rake_basis_points is null) = (rake_cap is null)),
  check (rake_basis_points between 0 and 10000 and rake_cap >= 0)
);

create table public.gto_libraries (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  config_key text not null references public.gto_game_configs(key),
  title text not null,
  created_at timestamptz not null default now()
);
create index gto_libraries_config_idx on public.gto_libraries(config_key);

create table public.gto_strategy_versions (
  library_key text not null references public.gto_libraries(key),
  revision integer not null check (revision > 0),
  adapter_version integer not null check (adapter_version > 0),
  study_path text not null references public.study_files(path),
  preset_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  combo_order text not null,
  created_at timestamptz not null default now(),
  primary key (library_key, revision)
);
create index gto_strategy_versions_study_idx on public.gto_strategy_versions(study_path);

create table public.gto_preflop_nodes (
  library_key text not null,
  revision integer not null,
  node_key text not null,
  parent_key text,
  actor text check (actor in ('UTG', 'MP', 'CO', 'BTN', 'SB', 'BB')),
  source_spot text,
  actions jsonb not null default '[]' check (jsonb_typeof(actions) = 'array'),
  primary key (library_key, revision, node_key),
  foreign key (library_key, revision) references public.gto_strategy_versions(library_key, revision),
  foreign key (library_key, revision, parent_key) references public.gto_preflop_nodes(library_key, revision, node_key),
  check (parent_key is null or parent_key <> node_key)
);
create index gto_preflop_nodes_parent_idx on public.gto_preflop_nodes(library_key, revision, parent_key);

create table public.gto_postflop_matchups (
  library_key text not null,
  revision integer not null,
  matchup_key text not null,
  oop_position text not null check (oop_position in ('UTG', 'MP', 'CO', 'BTN', 'SB', 'BB')),
  ip_position text not null check (ip_position in ('UTG', 'MP', 'CO', 'BTN', 'SB', 'BB')),
  pot integer not null check (pot > 0),
  effective_stack integer not null check (effective_stack > 0),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  solver_config jsonb not null default '{}' check (jsonb_typeof(solver_config) = 'object'),
  primary key (library_key, revision, matchup_key),
  foreign key (library_key, revision, matchup_key) references public.gto_preflop_nodes(library_key, revision, node_key),
  check (oop_position <> ip_position)
);

create table public.gto_flop_solutions (
  library_key text not null,
  revision integer not null,
  matchup_key text not null,
  card0 smallint not null,
  card1 smallint not null,
  card2 smallint not null,
  format_version integer not null check (format_version > 0),
  strategy_path text not null,
  strategy_sha256 text not null check (strategy_sha256 ~ '^[0-9a-f]{64}$'),
  action_ev_path text,
  action_ev_sha256 text check (action_ev_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (library_key, revision, matchup_key, card0, card1, card2),
  foreign key (library_key, revision, matchup_key)
    references public.gto_postflop_matchups(library_key, revision, matchup_key),
  check (0 <= card0 and card0 < card1 and card1 < card2 and card2 <= 51),
  check (starts_with(strategy_path, library_key || '/' || revision || '/flops/')),
  check (starts_with(action_ev_path, library_key || '/' || revision || '/ev/')),
  check ((action_ev_path is null) = (action_ev_sha256 is null))
);

do $gto_rls$
declare
  relation text;
begin
  foreach relation in array array[
    'gto_game_configs', 'gto_libraries', 'gto_strategy_versions', 'gto_preflop_nodes',
    'gto_postflop_matchups', 'gto_flop_solutions'
  ]
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format($policy$
      create policy "PokerTools members can read GTO metadata" on public.%I for select to authenticated
      using ((select not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
        and exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))))
    $policy$, relation);
  end loop;
end
$gto_rls$;

insert into storage.buckets (id, name, public)
values ('gto-strategy-files', 'gto-strategy-files', false);

create policy "PokerTools members can read GTO files"
  on storage.objects for select to authenticated
  using (bucket_id = 'gto-strategy-files' and
    (select not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
      and exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))));

-- Scope restrictive policies to the new bucket so existing and future buckets retain their own access rules.
create policy "GTO files require PokerTools membership"
  on storage.objects as restrictive for select to authenticated
  using (bucket_id is distinct from 'gto-strategy-files' or
    (select not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
      and exists (select 1 from public.pokertools_members where user_id = (select auth.uid()))));
create policy "Anonymous role cannot read GTO files"
  on storage.objects as restrictive for select to anon
  using (bucket_id is distinct from 'gto-strategy-files');
create policy "GTO file creation requires an operator"
  on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id is distinct from 'gto-strategy-files');
create policy "GTO file updates require an operator"
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id is distinct from 'gto-strategy-files')
  with check (bucket_id is distinct from 'gto-strategy-files');
create policy "GTO file deletion requires an operator"
  on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id is distinct from 'gto-strategy-files');

insert into public.gto_game_configs (key, variant, seat_count, effective_stack, small_blind, big_blind)
values ('gtow-simple-100bb', 'nlhe', 6, 10000, 50, 100);

insert into public.gto_libraries (key, config_key, title)
values ('gtow-simple-100bb', 'gtow-simple-100bb', 'GTO Wizard Simple');

insert into public.gto_strategy_versions
  (library_key, revision, adapter_version, study_path, preset_name, source_sha256, combo_order)
select 'gtow-simple-100bb', 1, 1, path, 'GTOw 500nl Simple',
  'd49e18b0a993116ae177dfe51e12c3d30f9785cfe9b0650ec9381850fa4ea211', 'cdhs-low-major-v1'
from public.study_files
where path = 'preflop-ranges.tsv'
  and encode(sha256(convert_to(contents, 'UTF8')), 'hex') = 'd49e18b0a993116ae177dfe51e12c3d30f9785cfe9b0650ec9381850fa4ea211';

insert into public.gto_preflop_nodes (library_key, revision, node_key, actor, source_spot)
select library_key, revision, 'preflop', 'UTG', '2Bet/UTG/UTG'
from public.gto_strategy_versions
where library_key = 'gtow-simple-100bb' and revision = 1;
