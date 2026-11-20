create table public.flop_viewer_spots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  is_example boolean generated always as (owner_id is null) stored,
  configuration text not null check (char_length(configuration) between 1 and 120 and configuration = btrim(configuration)),
  board text not null check (
    board ~ '^([2-9TJQKA][cdhs]){3}$'
    and substr(board, 1, 2) <> substr(board, 3, 2)
    and substr(board, 1, 2) <> substr(board, 5, 2)
    and substr(board, 3, 2) <> substr(board, 5, 2)
  ),
  nodes jsonb not null check (case when jsonb_typeof(nodes) = 'array' then jsonb_array_length(nodes) > 0 else false end),
  unique nulls not distinct (owner_id, configuration, board)
);

alter table public.flop_viewer_spots enable row level security;
revoke all on public.flop_viewer_spots from public, anon, authenticated;
grant select on public.flop_viewer_spots to anon, authenticated;
grant insert (owner_id, configuration, board, nodes), update (owner_id, configuration, board, nodes)
  on public.flop_viewer_spots to authenticated;

create policy "Everyone can read the flop examples" on public.flop_viewer_spots
  for select to anon, authenticated using (owner_id is null);
create policy "Owners can read flop spots" on public.flop_viewer_spots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can import flop spots" on public.flop_viewer_spots
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can replace flop spots" on public.flop_viewer_spots
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create function public.flop_viewer_configurations()
returns table (configuration text, is_example boolean)
language sql stable security invoker
set search_path = ''
as $$
  select distinct spot.configuration, spot.is_example
  from public.flop_viewer_spots as spot
  order by spot.is_example, spot.configuration
$$;

revoke execute on function public.flop_viewer_configurations() from public, anon, authenticated;
grant execute on function public.flop_viewer_configurations() to anon, authenticated;

-- Illustrative strategies for trying the viewer before importing solver ranges.
insert into public.flop_viewer_spots (owner_id, configuration, board, nodes)
values (null, 'Example strategy', 'Ah7h2c', $json$
[
  {
    "name": "BTN c-bet",
    "actions": [{"label":"Check"},{"label":"B33"},{"label":"B75"}],
    "combos": [
      {"hand":"AsAd","weight":1,"frequencies":[25,25,50],"evs":[5.8,6,6.2]},
      {"hand":"AsAc","weight":1,"frequencies":[20,40,40],"evs":[5.6,5.9,6.1]},
      {"hand":"AdAc","weight":1,"frequencies":[20,30,50],"evs":[5.5,5.8,6.1]},
      {"hand":"AsKs","weight":1,"frequencies":[20,50,30],"evs":[3.4,3.5,3.6]},
      {"hand":"AdKd","weight":0.8,"frequencies":[40,55,5],"evs":[3.3,3.4,3.2]},
      {"hand":"AcKc","weight":1,"frequencies":[30,55,15],"evs":[3.4,3.5,3.4]},
      {"hand":"AsQc","weight":1,"frequencies":[70,30,0],"evs":[3.1,3.2,2.9]},
      {"hand":"AcJd","weight":0.8,"frequencies":[30,65,5],"evs":[2.9,3,2.8]},
      {"hand":"KhQh","weight":0.75,"frequencies":[30,35,35],"evs":[1.8,2,2.1]},
      {"hand":"KhJh","weight":0.75,"frequencies":[30,45,25],"evs":[1.7,1.9,1.9]},
      {"hand":"JhTh","weight":0.75,"frequencies":[40,35,25],"evs":[1.5,1.8,1.8]},
      {"hand":"9h8h","weight":0.75,"frequencies":[35,40,25],"evs":[1.4,1.7,1.7]},
      {"hand":"8s8c","weight":0.5,"frequencies":[65,35,0],"evs":[1.8,1.7,1.1]},
      {"hand":"7s7d","weight":1,"frequencies":[10,20,70],"evs":[5.5,5.8,6]},
      {"hand":"7d7c","weight":1,"frequencies":[15,25,60],"evs":[5.4,5.8,6]},
      {"hand":"2s2d","weight":1,"frequencies":[20,30,50],"evs":[5.2,5.6,5.8]},
      {"hand":"KcQd","weight":0.5,"frequencies":[75,25,0],"evs":[0.7,0.8,0.5]},
      {"hand":"JhTd","weight":0.4,"frequencies":[55,45,0],"evs":[0.5,0.6,0.3]}
    ]
  },
  {
    "name": "BB facing B33",
    "actions": [{"label":"Fold"},{"label":"Call"},{"label":"R75"}],
    "combos": [
      {"hand":"AsJc","weight":0.5,"frequencies":[0,90,10],"evs":[0,2.1,2.2]},
      {"hand":"KcQd","weight":1,"frequencies":[90,10,0],"evs":[0,0.1,-0.5]},
      {"hand":"KhQh","weight":0.75,"frequencies":[0,65,35],"evs":[0,1.5,1.7]},
      {"hand":"7s7d","weight":1,"frequencies":[0,40,60],"evs":[0,4.5,4.6]},
      {"hand":"7d5d","weight":0.5,"frequencies":[35,65,0],"evs":[0,0.6,0.1]},
      {"hand":"5h4h","weight":0.5,"frequencies":[10,65,25],"evs":[0,0.9,1.1]},
      {"hand":"3s2s","weight":0.5,"frequencies":[50,50,0],"evs":[0,0.4,-0.1]}
    ]
  }
]
$json$::jsonb),
(null, 'Example strategy', 'Ks8d3c', $json$
[
  {
    "name": "BTN c-bet",
    "actions": [{"label":"Check"},{"label":"B33"}],
    "combos": [
      {"hand":"AsAd","weight":1,"frequencies":[30,70],"evs":[4.6,4.9]},
      {"hand":"KhKd","weight":1,"frequencies":[15,85],"evs":[5.3,5.7]},
      {"hand":"AcKc","weight":1,"frequencies":[45,55],"evs":[3.8,3.9]},
      {"hand":"8s8c","weight":1,"frequencies":[20,80],"evs":[5.1,5.5]},
      {"hand":"AsQs","weight":0.75,"frequencies":[40,60],"evs":[1.1,1.3]},
      {"hand":"5c4c","weight":0.5,"frequencies":[55,45],"evs":[0.4,0.5]}
    ]
  }
]
$json$::jsonb);
