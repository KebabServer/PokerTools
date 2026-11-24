-- The original body remains the first page so existing notes need no rewrite.
alter table public.saved_notes
  add column pages jsonb not null default '{"firstTitle":"","extra":[]}'::jsonb,
  add constraint saved_notes_pages_check check (
    jsonb_typeof(pages -> 'firstTitle') is not distinct from 'string'
    and jsonb_typeof(pages -> 'extra') is not distinct from 'array'
    and not jsonb_path_exists(pages, '$.extra[*] ? (
      @.type() != "object"
      || !exists(@.id) || @.id.type() != "string" || @.id == "first"
      || !exists(@.title) || @.title.type() != "string"
      || !exists(@.body) || @.body.type() != "string"
    )')
  );

grant insert (pages), update (pages) on public.saved_notes to authenticated;
