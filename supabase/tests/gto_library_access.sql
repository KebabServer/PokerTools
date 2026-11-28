begin;
select '1..1';

insert into auth.users (id) values
  ('ab000000-0000-0000-0000-000000000001'),
  ('ab000000-0000-0000-0000-000000000002');
insert into public.pokertools_members (user_id) values ('ab000000-0000-0000-0000-000000000001');

insert into public.gto_preflop_nodes (library_key, revision, node_key, parent_key)
values ('gtow-simple-100bb', 1, 'preflop/access-test', 'preflop');
insert into public.gto_postflop_matchups
  (library_key, revision, matchup_key, oop_position, ip_position, pot, effective_stack, config_sha256)
values ('gtow-simple-100bb', 1, 'preflop/access-test', 'BB', 'BTN', 550, 9750, repeat('b', 64));
insert into public.gto_flop_solutions
  (library_key, revision, matchup_key, card0, card1, card2, format_version, strategy_path, strategy_sha256)
values ('gtow-simple-100bb', 1, 'preflop/access-test', 1, 20, 51, 1,
  'gtow-simple-100bb/1/flops/access-test.bin', repeat('c', 64));

insert into storage.buckets (id, name, public) values ('gto-test-other', 'gto-test-other', false);
insert into storage.objects (bucket_id, name) values
  ('gto-strategy-files', 'gtow-simple-100bb/1/flops/access-test.bin'), ('gto-test-other', 'other.bin');

-- Simulate a broad policy for another integration. GTO restrictions must still hold.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create policy "GTO test broad storage grant" on storage.objects for all to anon, authenticated
  using (true) with check (true);

do $test$
declare
  table_name text;
  observed integer;
  expected integer;
  session_fixture jsonb;
begin
  if (select public from storage.buckets where id = 'gto-strategy-files') is distinct from false then
    raise exception 'GTO strategy bucket must be private';
  end if;

  set local role authenticated;
  for session_fixture in
    select item from jsonb_array_elements('[
      {"sub":"ab000000-0000-0000-0000-000000000001","is_anonymous":false},
      {"sub":"ab000000-0000-0000-0000-000000000002","is_anonymous":false},
      {"sub":"ab000000-0000-0000-0000-000000000001","is_anonymous":true}
    ]'::jsonb) as fixtures(item)
  loop
    perform set_config('request.jwt.claims', session_fixture::text, true);
    perform set_config('request.jwt.claim.sub', session_fixture->>'sub', true);
    expected := case
      when session_fixture->>'sub' = 'ab000000-0000-0000-0000-000000000001'
        and not (session_fixture->>'is_anonymous')::boolean then 1
      else 0
    end;
    foreach table_name in array array[
      'gto_game_configs', 'gto_libraries', 'gto_strategy_versions', 'gto_preflop_nodes',
      'gto_postflop_matchups', 'gto_flop_solutions'
    ]
    loop
      execute format('select count(*) from public.%I where %I = $1', table_name,
        case when table_name in ('gto_game_configs', 'gto_libraries') then 'key' else 'library_key' end)
        into observed using 'gtow-simple-100bb';
      if (observed > 0) <> (expected = 1) then
        raise exception 'Incorrect visibility for %', table_name;
      end if;
    end loop;
    if (select count(*) from storage.objects where bucket_id = 'gto-strategy-files'
        and name = 'gtow-simple-100bb/1/flops/access-test.bin') <> expected then
      raise exception 'Incorrect visibility for GTO Storage objects';
    end if;
  end loop;

  perform set_config('request.jwt.claims',
    '{"sub":"ab000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
  begin
    update public.gto_libraries set title = 'Unexpected write' where key = 'gtow-simple-100bb';
    raise exception 'Browser metadata write should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('gto-strategy-files', 'access-test-injected.bin');
    raise exception 'Browser upload should fail';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where bucket_id = 'gto-strategy-files';
  if found then raise exception 'Browser deletion should leave GTO files intact'; end if;
  update storage.objects set name = 'access-test-replaced.bin' where bucket_id = 'gto-strategy-files';
  if found then raise exception 'Browser update should leave GTO files intact'; end if;
  begin
    update storage.objects set bucket_id = 'gto-strategy-files' where bucket_id = 'gto-test-other';
    raise exception 'Moving a file from another bucket should fail';
  exception when insufficient_privilege then null;
  end;

  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform count(*) from public.gto_strategy_versions;
    raise exception 'Anonymous metadata access should fail';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from storage.objects where bucket_id = 'gto-strategy-files')
      or not exists (select 1 from storage.objects where bucket_id = 'gto-test-other') then
    raise exception 'Anonymous visibility must be scoped to the GTO bucket';
  end if;
  reset role;
end
$test$;

select 'ok 1 - GTO catalog and files require membership and operator writes';
rollback;
