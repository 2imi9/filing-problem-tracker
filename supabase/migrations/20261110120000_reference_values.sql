-- Filing Problem Tracker, migration 1 of 3: reference values.
--
-- The lists the check constraints test against. They mirror src/lib/domain.ts, src/lib/time.ts and the
-- limits in src/server/config.ts. tests/rls/drift.test.ts compares every one of them with the TypeScript
-- value and fails when they differ. To change a list: change the TypeScript, then add a new migration
-- that replaces the function here (create or replace), and run the tests.
--
-- These functions hold public reference data only. Signed-in users may call them because a check
-- constraint runs with the privileges of the person inserting the row.

create function public.app_roles() returns text[]
language sql immutable parallel safe set search_path = ''
as $$ select array['clerk', 'leader', 'admin']::text[] $$;

create function public.app_counties() returns text[]
language sql immutable parallel safe set search_path = ''
as $$
  select array[
    'Marion', 'Lake', 'Allen', 'Hamilton', 'St. Joseph', 'Vanderburgh', 'Monroe', 'Tippecanoe'
  ]::text[]
$$;

-- Case type -> the forms used for it.
create function public.app_case_forms() returns jsonb
language sql immutable parallel safe set search_path = ''
as $$
  select jsonb_build_object(
    'Small claims', jsonb_build_array('Small claims notice of claim', 'Small claims counterclaim'),
    'Protective order', jsonb_build_array('Petition for order of protection', 'Petition to modify or extend order'),
    'Family', jsonb_build_array(
      'Petition for dissolution, no children',
      'Petition for dissolution, with children',
      'Petition to modify child support'
    ),
    'Eviction', jsonb_build_array('Tenant answer or request for hearing'),
    'Name change', jsonb_build_array('Petition for change of name')
  )
$$;

create function public.app_tags() returns text[]
language sql immutable parallel safe set search_path = ''
as $$
  select array[
    'Missing signature',
    'Wrong form',
    'Wrong county or court',
    'Missing required details',
    'Missing fee or fee waiver',
    'Citation not found or wrong',
    'Missing addresses for service',
    'Not verified or notarized',
    'Pages missing or unreadable'
  ]::text[]
$$;

-- The marker on imported rows that nobody has sorted yet.
create function public.app_needs_review() returns text
language sql immutable parallel safe set search_path = ''
as $$ select 'Needs review'::text $$;

create function public.app_outcomes() returns text[]
language sql immutable parallel safe set search_path = ''
as $$ select array['Rejected', 'Returned to fix', 'Fixed at counter']::text[] $$;

create function public.app_sources() returns text[]
language sql immutable parallel safe set search_path = ''
as $$ select array['sample', 'clerk', 'import']::text[] $$;

-- Earliest filing date the tracker accepts.
create function public.app_min_date() returns date
language sql immutable parallel safe set search_path = ''
as $$ select date '2020-01-01' $$;

-- The courts' time zone. "Today" is the calendar day there.
create function public.app_time_zone() returns text
language sql immutable parallel safe set search_path = ''
as $$ select 'America/Indiana/Indianapolis'::text $$;

create function public.app_today() returns date
language sql stable parallel safe set search_path = ''
as $$ select (now() at time zone public.app_time_zone())::date $$;

-- How long a clerk can remove their own entry, and undo that.
create function public.app_delete_window() returns interval
language sql immutable parallel safe set search_path = ''
as $$ select interval '5 minutes' $$;

-- Folders one person can keep.
create function public.app_folder_limit() returns integer
language sql immutable parallel safe set search_path = ''
as $$ select 50 $$;

-- True when the form is one of the forms listed for the case type.
create function public.app_form_matches(p_case_type text, p_form text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$ select coalesce(public.app_case_forms() -> p_case_type ? p_form, false) $$;

-- True for a usable list of problems: one to nine values from the list, each once. "Needs review" is
-- allowed only where p_allow_review says so, and then it must stand alone.
create function public.app_tags_valid(p_tags text[], p_allow_review boolean) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select p_tags is not null
    and array_ndims(p_tags) = 1
    and cardinality(p_tags) between 1 and cardinality(public.app_tags())
    and array_position(p_tags, null) is null
    and (select count(distinct t) from unnest(p_tags) as t) = cardinality(p_tags)
    and case
      when public.app_needs_review() = any (p_tags) then p_allow_review and cardinality(p_tags) = 1
      else p_tags <@ public.app_tags()
    end
$$;

-- Free text as the app stores it: one line, single spaces, no space at either end.
create function public.app_one_line(p_text text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$ select p_text = btrim(regexp_replace(p_text, '\s+', ' ', 'g')) $$;

-- Supabase grants execute on new functions to anon and authenticated by default, and Postgres grants it
-- to everyone. Take both away, then give signed-in users what the constraints need.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.app_roles()',
    'public.app_counties()',
    'public.app_case_forms()',
    'public.app_tags()',
    'public.app_needs_review()',
    'public.app_outcomes()',
    'public.app_sources()',
    'public.app_min_date()',
    'public.app_time_zone()',
    'public.app_today()',
    'public.app_delete_window()',
    'public.app_folder_limit()',
    'public.app_form_matches(text, text)',
    'public.app_tags_valid(text[], boolean)',
    'public.app_one_line(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$$;
