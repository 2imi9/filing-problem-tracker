-- Filing Problem Tracker, migration 2 of 3: tables, check constraints and indexes.
--
-- The check constraints mirror the Zod schemas in src/lib/schemas.ts, so a value the app would refuse is
-- also refused when it reaches the database some other way. One thing cannot be mirrored here: the
-- personal data check on notes and reasons (src/lib/pii.ts) is pattern matching in the app.
--
-- Nothing in these tables identifies a litigant: no names, no case numbers.
-- Access rules are in the next migration. Until it runs, no API role can read or write anything here.

-- One row per person who may use the tracker. Invite only: an administrator adds the row. Nothing adds
-- it automatically, and a signed-in user without a row here can read and write nothing.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null,
  county text,
  created_at timestamptz not null default now(),
  constraint profiles_role_known check (role = any (public.app_roles())),
  constraint profiles_county_known check (county is null or county = any (public.app_counties())),
  -- A clerk works in exactly one county. Leaders and administrators have none.
  constraint profiles_county_matches_role check ((role = 'clerk') = (county is not null))
);

-- One row per committed CSV import.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  row_count integer not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint import_batches_name_length check (char_length(name) between 1 and 80 and public.app_one_line(name)),
  constraint import_batches_row_count_range check (row_count between 1 and 10000)
);

create index import_batches_created_by_idx on public.import_batches (created_by);

-- One row per flagged filing.
create table public.filing_flags (
  -- Insertion order, for stable listing and paging.
  seq bigint generated always as identity unique,
  id text primary key default gen_random_uuid()::text,
  county text not null,
  filed_on date not null,
  case_type text not null,
  form text not null,
  tags text[] not null,
  outcome text not null,
  -- Optional clerk note. The app checks it for personal data before saving.
  note text,
  -- The clerk's raw rejection reason on an imported row.
  reason text,
  source text not null default 'clerk',
  batch_id uuid references public.import_batches (id) on delete restrict,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set when the entry is removed. Removed entries are kept, and left out of every count.
  deleted_at timestamptz,
  -- Who removed it. Set by the database together with deleted_at and cleared on restore, never by the
  -- caller. A clerk may undo their own removal only, so the restore rule needs to know whose it was.
  deleted_by uuid references auth.users (id) on delete set null,
  constraint filing_flags_id_length check (char_length(id) between 1 and 64),
  constraint filing_flags_county_known check (county = any (public.app_counties())),
  constraint filing_flags_date_range check (filed_on >= public.app_min_date() and filed_on <= public.app_today()),
  constraint filing_flags_form_matches_case_type check (public.app_form_matches(case_type, form)),
  constraint filing_flags_tags_valid check (public.app_tags_valid(tags, source = 'import')),
  constraint filing_flags_outcome_known check (outcome = any (public.app_outcomes())),
  constraint filing_flags_source_known check (source = any (public.app_sources())),
  constraint filing_flags_note_length check (note is null or (char_length(note) between 1 and 200 and public.app_one_line(note))),
  constraint filing_flags_reason_length check (reason is null or (char_length(reason) between 1 and 500 and public.app_one_line(reason))),
  -- An imported row belongs to a batch, was rejected, and carries a reason, never a note.
  -- Every other row has no batch and no reason.
  constraint filing_flags_import_shape check (
    case
      when source = 'import' then batch_id is not null and outcome = 'Rejected' and note is null
      else batch_id is null and reason is null
    end
  ),
  constraint filing_flags_sample_has_no_author check (source <> 'sample' or (created_by is null and note is null))
);

create index filing_flags_county_filed_on_idx on public.filing_flags (county, filed_on);
create index filing_flags_filed_on_idx on public.filing_flags (filed_on);
create index filing_flags_tags_idx on public.filing_flags using gin (tags);
create index filing_flags_created_by_idx on public.filing_flags (created_by, created_at desc);
create index filing_flags_batch_id_idx on public.filing_flags (batch_id) where batch_id is not null;

-- A change a court made (a revised form, a guide, a kiosk) that the before/after panel measures.
create table public.change_events (
  seq bigint generated always as identity unique,
  id text primary key default gen_random_uuid()::text,
  name text not null,
  event_date date not null,
  county text not null,
  case_type text not null,
  -- The problem the change was meant to reduce.
  tag text not null,
  description text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint change_events_id_length check (char_length(id) between 1 and 64),
  constraint change_events_name_length check (char_length(name) between 1 and 80 and public.app_one_line(name)),
  constraint change_events_date_range check (event_date >= public.app_min_date() and event_date <= public.app_today()),
  constraint change_events_county_known check (county = any (public.app_counties())),
  constraint change_events_case_type_known check (public.app_case_forms() ? case_type),
  constraint change_events_tag_known check (tag = any (public.app_tags())),
  constraint change_events_description_length check (char_length(description) <= 300 and public.app_one_line(description))
);

-- A saved set of workspace panels. Each person has their own, and ids are unique per person.
create table public.workspace_folders (
  seq bigint generated always as identity unique,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null,
  -- PanelSpec[] as validated by the app (src/lib/schemas.ts). The database checks shape and size only.
  panels jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, id),
  constraint workspace_folders_id_length check (char_length(id) between 1 and 64),
  constraint workspace_folders_name_length check (char_length(name) between 1 and 60 and public.app_one_line(name)),
  constraint workspace_folders_panels_shape check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) <= 24),
  constraint workspace_folders_panels_size check (octet_length(panels::text) <= 131072)
);

-- The folder that holds a person's open workspace panels has the reserved name "__current"
-- (CURRENT_FOLDER_NAME in src/lib/panels.ts). There is one per person: two browser tabs that both save
-- it for the first time must end up with one folder, not two.
create unique index workspace_folders_one_current_idx on public.workspace_folders (owner) where name = '__current';

-- Who has been given the example folders, so they are added once and stay deleted when deleted.
create table public.workspace_seeds (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  seeded_at timestamptz not null default now()
);

-- Who did what. Rows are added and never changed. No foreign key to auth.users: entries outlive accounts.
create table public.audit_log (
  seq bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid not null,
  role text not null,
  action text not null,
  entity text not null,
  entity_id text,
  -- Counts and reference values only. Never note text, never a raw reason.
  detail jsonb not null default '{}'::jsonb,
  constraint audit_log_role_known check (role = any (public.app_roles())),
  constraint audit_log_action_shape check (action ~ '^[a-z_]{1,32}\.[a-z_]{1,32}$'),
  constraint audit_log_entity_shape check (entity ~ '^[a-z_]{1,32}$'),
  constraint audit_log_entity_id_length check (entity_id is null or char_length(entity_id) between 1 and 64),
  constraint audit_log_detail_shape check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096)
);

create index audit_log_at_idx on public.audit_log (at desc, seq desc);

-- Access tokens for the MCP endpoint, one row per token, stored as the SHA-256 hash only.
-- To revoke a token, set revoked_at.
create table public.mcp_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint mcp_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_tokens_label_length check (char_length(label) <= 80)
);

create index mcp_tokens_user_id_idx on public.mcp_tokens (user_id);

-- Lock every table before anything else happens. Supabase grants new tables in the public schema to its
-- API roles by default; this takes that away and turns row level security on, forced, so that the table
-- owner is held to the policies too. The next migration grants back exactly what each role needs.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'import_batches',
    'filing_flags',
    'change_events',
    'workspace_folders',
    'workspace_seeds',
    'audit_log',
    'mcp_tokens'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end
$$;

-- The same for the counters behind the seq columns. Inserts do not need a privilege on them.
revoke all on sequence
  public.filing_flags_seq_seq,
  public.change_events_seq_seq,
  public.workspace_folders_seq_seq,
  public.audit_log_seq_seq
from public, anon, authenticated;
