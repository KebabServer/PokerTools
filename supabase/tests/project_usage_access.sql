begin;
select '1..1';

insert into auth.users (id) values
  ('ac000000-0000-0000-0000-000000000001'),
  ('ac000000-0000-0000-0000-000000000002');
insert into public.pokertools_members (user_id) values ('ac000000-0000-0000-0000-000000000001');

insert into storage.buckets (id, name, public) values ('usage-test-a', 'usage-test-a', false), ('usage-test-b', 'usage-test-b', false);
insert into storage.objects (bucket_id, name, metadata) values
  ('usage-test-a', 'usage-test.bin', '{"size":4000}'), ('usage-test-b', 'usage-test.bin', '{"size":6000}');

do $test$
declare
  usage record;
  expected_db bigint := (select sum(pg_database_size(datname)) from pg_database);
  expected_storage bigint := (select sum((metadata->>'size')::bigint) from storage.objects);
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","is_anonymous":false}', true);
  select * into strict usage from public.pokertools_project_usage();
  if usage.database_bytes is distinct from expected_db or usage.storage_bytes is distinct from expected_storage
    or usage.database_bytes <= 0 or usage.storage_bytes < 10000 then
    raise exception 'Project usage totals are incorrect';
  end if;

  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000002","is_anonymous":false}', true);
  begin
    perform * from public.pokertools_project_usage();
    raise exception 'Nonmembers should not be able to read project usage';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","is_anonymous":true}', true);
  begin
    perform * from public.pokertools_project_usage();
    raise exception 'Anonymous sessions should not be able to read project usage';
  exception when insufficient_privilege then null;
  end;

  reset role;
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  if has_function_privilege(current_user, 'public.pokertools_project_usage()', 'execute') then
    raise exception 'The anonymous role should have no execute grant on the API function';
  end if;
  reset role;
end
$test$;

select 'ok 1 - PokerTools member access to project usage';
rollback;
