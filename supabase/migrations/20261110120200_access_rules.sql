-- Filing Problem Tracker, migration 3 of 3: who can do what.
--
-- This is the access table in ARCHITECTURE.md, enforced by the database:
--
--                             clerk                          leader         admin
--   Read flags                own county                     all counties   all
--   Read notes / raw reasons  own entries; own county's      no             all
--                             needs-review rows
--   Create flag / import      own county only                no             any county
--   Delete own flag           within 5 minutes               no             any time
--   Change events             read                           read           read + write
--   Folders                   own                            own            own
--   Audit log                 no                             no             read
--
-- How it is built:
--   * The app connects with the signed-in person's own token (Postgres role "authenticated"), never the
--     service role key, so every statement goes through the policies below.
--   * A person's role and county come from their profiles row, read by app_role() and app_county().
--     No profile means both are null, every policy is false, and the person can do nothing.
--   * Row level security is enabled and forced on every table (previous migration).
--   * Table privileges are granted column by column. "authenticated" has NO select privilege on
--     filing_flags.note or filing_flags.reason, so no query against the table can read, filter on or
--     return them, for any role. The two functions my_recent_flags() and needs_review_flags() are the
--     only way to the free text, and they apply the "Read notes / raw reasons" row themselves.
--   * For an administrator, "all" notes and reasons means not limited by county: every county's
--     needs-review rows and the notes on their own entries. Nothing lists every note, because the app
--     has no screen that would.
--   * The service role key is used for one thing: answering for an MCP token (last section).
--   * "anon" (not signed in) is granted nothing.
--
-- app_role(), app_county(), the two text functions and the three MCP functions are security definer:
-- they read as the role that owns them. On Supabase that is "postgres", which has BYPASSRLS, so the
-- forced policies do not apply to it. An owner without BYPASSRLS would be held to the forced policies
-- itself, none of which are written for it: app_role() would find no profile for anyone and every
-- person would be locked out. That fails closed, but the app would be unusable, so keep these functions
-- owned by a role that bypasses row level security.

-- ---------------------------------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------------------------------

create function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.user_id = (select auth.uid()) $$;

create function public.app_county() returns text
language sql stable security definer set search_path = ''
as $$ select p.county from public.profiles p where p.user_id = (select auth.uid()) $$;

revoke all on function public.app_role() from public, anon, authenticated;
revoke all on function public.app_county() from public, anon, authenticated;
grant execute on function public.app_role() to authenticated;
grant execute on function public.app_county() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- profiles: a person reads their own row; administrators manage all rows
-- ---------------------------------------------------------------------------------------------------

grant select, insert, update, delete on table public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_role()) = 'admin');

create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy profiles_update on public.profiles for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy profiles_delete on public.profiles for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------------
-- import_batches: clerks and administrators add their own; read your own, administrators read all
-- ---------------------------------------------------------------------------------------------------

grant select on table public.import_batches to authenticated;
grant insert (name, row_count, created_by) on table public.import_batches to authenticated;

create policy import_batches_select on public.import_batches for select to authenticated
  using (
    (select public.app_role()) = 'admin'
    or ((select public.app_role()) = 'clerk' and created_by = (select auth.uid()))
  );

create policy import_batches_insert on public.import_batches for insert to authenticated
  with check ((select public.app_role()) in ('clerk', 'admin') and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------
-- filing_flags
-- ---------------------------------------------------------------------------------------------------

-- Every column except note and reason. See the header.
grant select (seq, id, county, filed_on, case_type, form, tags, outcome, source, batch_id, created_by, created_at, deleted_at)
  on table public.filing_flags to authenticated;
-- id, created_at and deleted_at cannot be supplied: the database sets them. created_by and county can be
-- supplied, and the insert policy refuses any value but the caller's own.
grant insert (county, filed_on, case_type, form, tags, outcome, note, reason, source, batch_id, created_by)
  on table public.filing_flags to authenticated;
-- Removing and restoring an entry is the only change there is.
grant update (deleted_at) on table public.filing_flags to authenticated;

-- Read: a clerk their own county, leaders and administrators every county. A removed entry stays
-- visible to the person who added it and to administrators, so that it can be restored. (It also has
-- to: Postgres checks the changed row against this policy when an entry is removed.)
create policy filing_flags_select on public.filing_flags for select to authenticated
  using (
    (
      (select public.app_role()) in ('leader', 'admin')
      or ((select public.app_role()) = 'clerk' and county = (select public.app_county()))
    )
    and (
      deleted_at is null
      or created_by = (select auth.uid())
      or (select public.app_role()) = 'admin'
    )
  );

-- Create: a clerk for their own county, an administrator for any county, a leader never. The author
-- is always the caller. A row can only join an import batch the caller made.
create policy filing_flags_insert on public.filing_flags for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and source in ('clerk', 'import')
    and (
      (select public.app_role()) = 'admin'
      or ((select public.app_role()) = 'clerk' and county = (select public.app_county()))
    )
    and (
      batch_id is null
      or exists (
        select 1 from public.import_batches b
        where b.id = filing_flags.batch_id and b.created_by = (select auth.uid())
      )
    )
  );

-- Remove and restore: an administrator any entry at any time. A clerk only an entry they added, in
-- their own county: remove within the window after adding it, restore within the window after
-- removing it themselves. An entry an administrator removed is not the clerk's to put back.
create policy filing_flags_update on public.filing_flags for update to authenticated
  using (
    (select public.app_role()) = 'admin'
    or (
      (select public.app_role()) = 'clerk'
      and created_by = (select auth.uid())
      and county = (select public.app_county())
      and (
        (deleted_at is null and created_at >= now() - public.app_delete_window())
        or (
          deleted_at is not null
          and deleted_at >= now() - public.app_delete_window()
          and deleted_by = (select auth.uid())
        )
      )
    )
  )
  with check (
    (select public.app_role()) = 'admin'
    or (
      (select public.app_role()) = 'clerk'
      and created_by = (select auth.uid())
      and county = (select public.app_county())
    )
  );

-- The time an entry was removed is the database's clock, never a value from the caller. Without this
-- a clerk could date a removal in the future and keep the restore window open. Who removed it is
-- recorded the same way: the caller, as the database knows them. An entry that is already removed keeps
-- both values, and a restored entry has neither.
create function public.filing_flags_stamp_removal() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    if old.deleted_at is null then
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    else
      new.deleted_at := old.deleted_at;
      new.deleted_by := old.deleted_by;
    end if;
  else
    new.deleted_by := null;
  end if;
  return new;
end
$$;

revoke all on function public.filing_flags_stamp_removal() from public, anon, authenticated;

create trigger filing_flags_stamp_removal
  before update on public.filing_flags
  for each row execute function public.filing_flags_stamp_removal();

-- What dashboards, leaders, the AI summary and the MCP tools read: current entries without free text.
-- security_invoker makes the view run as the person asking, so the policies above decide the rows.
create view public.flags_lean
with (security_invoker = true)
as
  select seq, id, county, filed_on, case_type, form, tags, outcome, source, batch_id, created_by, created_at
  from public.filing_flags
  where deleted_at is null;

revoke all on table public.flags_lean from public, anon, authenticated;
grant select on table public.flags_lean to authenticated;

-- The caller's own current entries, newest first, with the note. A clerk's entries from a county they
-- no longer work in are left out.
create function public.my_recent_flags(p_limit integer default 10) returns setof public.filing_flags
language sql stable security definer set search_path = ''
as $$
  select f.*
  from public.filing_flags f
  where f.created_by = (select auth.uid())
    and f.deleted_at is null
    and (
      (select public.app_role()) = 'admin'
      or ((select public.app_role()) = 'clerk' and f.county = (select public.app_county()))
    )
  order by f.created_at desc, f.seq desc
  limit least(greatest(coalesce(p_limit, 10), 0), 50)
$$;

-- Imported rows nobody has sorted yet, with the raw reason: a clerk their own county's, an
-- administrator every county's. Anyone else is refused.
create function public.needs_review_flags() returns setof public.filing_flags
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_county text := public.app_county();
begin
  if v_role is null or v_role not in ('clerk', 'admin') then
    raise exception 'raw rejection reasons are not available to this role' using errcode = '42501';
  end if;
  return query
    select f.*
    from public.filing_flags f
    where f.deleted_at is null
      and f.source = 'import'
      and f.tags @> array[public.app_needs_review()]
      and (v_role = 'admin' or f.county = v_county)
    order by f.seq;
end
$$;

revoke all on function public.my_recent_flags(integer) from public, anon, authenticated;
revoke all on function public.needs_review_flags() from public, anon, authenticated;
grant execute on function public.my_recent_flags(integer) to authenticated;
grant execute on function public.needs_review_flags() to authenticated;

-- Saves reviewed import rows as one batch, all or nothing. It runs as the caller (security invoker),
-- so the policies and check constraints above apply to every row. p_rows is an array of
-- { date, county, caseType, form, reason, tags } as the app's ImportRow.
create function public.import_flags(p_name text, p_rows jsonb)
returns table (batch uuid, inserted integer)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_batch uuid;
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'there are no rows to add' using errcode = '22023';
  end if;

  insert into public.import_batches (name, row_count, created_by)
  values (p_name, jsonb_array_length(p_rows), auth.uid())
  returning id into v_batch;

  insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, reason, source, batch_id, created_by)
  select
    r.value ->> 'county',
    (r.value ->> 'date')::date,
    r.value ->> 'caseType',
    r.value ->> 'form',
    array(select jsonb_array_elements_text(r.value -> 'tags')),
    'Rejected',
    nullif(r.value ->> 'reason', ''),
    'import',
    v_batch,
    auth.uid()
  from jsonb_array_elements(p_rows) with ordinality as r (value, position)
  order by r.position;
  get diagnostics v_count = row_count;

  return query select v_batch, v_count;
end
$$;

revoke all on function public.import_flags(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_flags(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- change_events: everyone with a profile reads; administrators write
-- ---------------------------------------------------------------------------------------------------

grant select, delete on table public.change_events to authenticated;
grant insert (name, event_date, county, case_type, tag, description, created_by) on table public.change_events to authenticated;
grant update (name, event_date, county, case_type, tag, description) on table public.change_events to authenticated;

create policy change_events_select on public.change_events for select to authenticated
  using ((select public.app_role()) is not null);

create policy change_events_insert on public.change_events for insert to authenticated
  with check ((select public.app_role()) = 'admin' and created_by = (select auth.uid()));

create policy change_events_update on public.change_events for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy change_events_delete on public.change_events for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- ---------------------------------------------------------------------------------------------------
-- workspace_folders: each person their own, and only people with a profile
-- ---------------------------------------------------------------------------------------------------

grant select, delete on table public.workspace_folders to authenticated;
grant insert (id, owner, name, panels) on table public.workspace_folders to authenticated;
grant update (name, panels) on table public.workspace_folders to authenticated;

create policy workspace_folders_select on public.workspace_folders for select to authenticated
  using (owner = (select auth.uid()) and (select public.app_role()) is not null);

create policy workspace_folders_insert on public.workspace_folders for insert to authenticated
  with check (owner = (select auth.uid()) and (select public.app_role()) is not null);

create policy workspace_folders_update on public.workspace_folders for update to authenticated
  using (owner = (select auth.uid()) and (select public.app_role()) is not null)
  with check (owner = (select auth.uid()) and (select public.app_role()) is not null);

create policy workspace_folders_delete on public.workspace_folders for delete to authenticated
  using (owner = (select auth.uid()) and (select public.app_role()) is not null);

-- Keeps the folder count per person within the limit, and stamps changes.
create function public.workspace_folders_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.workspace_folders f where f.owner = new.owner) >= public.app_folder_limit() then
      raise exception 'folder limit reached' using errcode = '23514';
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;

revoke all on function public.workspace_folders_guard() from public, anon, authenticated;

create trigger workspace_folders_guard
  before insert or update on public.workspace_folders
  for each row execute function public.workspace_folders_guard();

grant select on table public.workspace_seeds to authenticated;
grant insert (owner) on table public.workspace_seeds to authenticated;

create policy workspace_seeds_select on public.workspace_seeds for select to authenticated
  using (owner = (select auth.uid()) and (select public.app_role()) is not null);

create policy workspace_seeds_insert on public.workspace_seeds for insert to authenticated
  with check (owner = (select auth.uid()) and (select public.app_role()) is not null);

-- Gives the caller the example folders the first time it is called, and does nothing after that, so a
-- deleted example stays deleted. Returns one row saying whether it added them. Runs as the caller.
-- p_folders is an array of { id, name, panels }.
create function public.seed_example_folders(p_folders jsonb)
returns table (seeded boolean)
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.workspace_seeds (owner) values (auth.uid()) on conflict (owner) do nothing;
  if not found then
    return query select false;
    return;
  end if;
  insert into public.workspace_folders (id, owner, name, panels)
  select f.value ->> 'id', auth.uid(), f.value ->> 'name', f.value -> 'panels'
  from jsonb_array_elements(p_folders) with ordinality as f (value, position)
  order by f.position;
  return query select true;
end
$$;

revoke all on function public.seed_example_folders(jsonb) from public, anon, authenticated;
grant execute on function public.seed_example_folders(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- audit_log: signed-in people add entries about themselves; administrators read; nobody changes
-- ---------------------------------------------------------------------------------------------------

grant select on table public.audit_log to authenticated;
-- "at" cannot be supplied: the database's clock stamps the entry.
grant insert (id, user_id, role, action, entity, entity_id, detail) on table public.audit_log to authenticated;

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (user_id = (select auth.uid()) and role = (select public.app_role()));

-- ---------------------------------------------------------------------------------------------------
-- mcp_tokens: no API role can read or write the table
-- ---------------------------------------------------------------------------------------------------

-- No grants and no policies for anon or authenticated. Tokens are issued and revoked by an operator in
-- the SQL editor (see supabase/README.md).
--
-- A program calling the MCP endpoint has a token but no sign-in session, so the app cannot act as that
-- person through the policies above. The three functions below are the only thing the app's service
-- role key is used for. Each takes the token's hash, does nothing for an unknown or revoked token or a
-- token whose holder has no profile, and applies the holder's own scope itself: the same "Read flags"
-- rule as filing_flags_select, without free text, and nothing can be written.
revoke all on table public.mcp_tokens from service_role;

-- The token holder, or no row.
create function public.mcp_token_user(p_token_hash text)
returns table (token_hash text, user_id uuid, email text, role text, county text)
language sql stable security definer set search_path = ''
as $$
  select t.token_hash, t.user_id, u.email::text, p.role, p.county
  from public.mcp_tokens t
  join public.profiles p on p.user_id = t.user_id
  join auth.users u on u.id = t.user_id
  where t.token_hash = p_token_hash and t.revoked_at is null
$$;

-- The current flags the token holder may read, without free text: a clerk their own county, a leader
-- or an administrator every county.
create function public.mcp_flags(p_token_hash text) returns setof public.flags_lean
language sql stable security definer set search_path = ''
as $$
  select f.seq, f.id, f.county, f.filed_on, f.case_type, f.form, f.tags, f.outcome, f.source, f.batch_id, f.created_by, f.created_at
  from public.mcp_tokens t
  join public.profiles p on p.user_id = t.user_id
  join public.filing_flags f on p.role in ('leader', 'admin') or (p.role = 'clerk' and f.county = p.county)
  where t.token_hash = p_token_hash and t.revoked_at is null and f.deleted_at is null
$$;

-- The change events, for any live token whose holder has a profile.
create function public.mcp_change_events(p_token_hash text) returns setof public.change_events
language sql stable security definer set search_path = ''
as $$
  select e.*
  from public.change_events e
  where exists (
    select 1
    from public.mcp_tokens t
    join public.profiles p on p.user_id = t.user_id
    where t.token_hash = p_token_hash and t.revoked_at is null
  )
$$;

revoke all on function public.mcp_token_user(text) from public, anon, authenticated;
revoke all on function public.mcp_flags(text) from public, anon, authenticated;
revoke all on function public.mcp_change_events(text) from public, anon, authenticated;
grant execute on function public.mcp_token_user(text) to service_role;
grant execute on function public.mcp_flags(text) to service_role;
grant execute on function public.mcp_change_events(text) to service_role;
