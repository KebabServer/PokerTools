create schema pokertools_private;
revoke all on schema pokertools_private from public, anon, authenticated;
grant usage on schema pokertools_private to authenticated;

-- The database report includes every database in this project. Storage size is
-- the total metadata size of the currently stored objects across its buckets.
create function pokertools_private.project_usage()
returns table (database_bytes bigint, storage_bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
begin
  if member_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    or not exists (select 1 from public.pokertools_members where user_id = member_id) then
    raise exception 'PokerTools membership is required' using errcode = '42501';
  end if;

  return query select
    (select sum(pg_catalog.pg_database_size(d.datname))::bigint from pg_catalog.pg_database d),
    (select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o);
end;
$$;

revoke all on function pokertools_private.project_usage() from public, anon, authenticated;
grant execute on function pokertools_private.project_usage() to authenticated;

create function public.pokertools_project_usage()
returns table (database_bytes bigint, storage_bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select usage.database_bytes, usage.storage_bytes from pokertools_private.project_usage() usage;
$$;

revoke all on function public.pokertools_project_usage() from public, anon, authenticated;
grant execute on function public.pokertools_project_usage() to authenticated;
