-- Punt Master — migration 7
-- Closes the last read gap: until now, "you need the code to get in" was
-- only true inside the app's own screens. Anyone who found the app's public
-- key (visible to anyone who inspects the site's network requests — that's
-- normal, not a leak) could query the leagues/members/gameweeks/fixtures/
-- predictions tables directly and pull every league's names and picks, not
-- just ones they'd been given a code for. This removes the open read
-- policies and replaces them with functions that only return data once
-- you've already supplied a real code (or a real ID chained from one) —
-- same idea as the PIN-gated admin writes and password-gated picks.

drop policy if exists "public read leagues" on leagues;
drop policy if exists "public read members" on members;
drop policy if exists "public read gameweeks" on gameweeks;
drop policy if exists "public read fixtures" on fixtures;
drop policy if exists "public read predictions" on predictions;
-- No replacement select policies — RLS is enabled with no matching policy,
-- which means direct reads are denied by default. Only these functions
-- (running as their owner, not the caller) can still see the tables.

create or replace function get_league_by_code(p_code text)
returns table(id uuid, code text, name text, admin_name text, created_at timestamptz)
language sql
security definer
as $$
  select id, code, name, admin_name, created_at from leagues where code = p_code;
$$;

create or replace function get_members(p_league_id uuid)
returns table(id uuid, league_id uuid, name text, team text, joined_at timestamptz, last_active_at timestamptz)
language sql
security definer
as $$
  select id, league_id, name, team, joined_at, last_active_at from members where league_id = p_league_id;
$$;

create or replace function get_gameweeks(p_league_id uuid)
returns table(id uuid, league_id uuid, number int, created_at timestamptz)
language sql
security definer
as $$
  select id, league_id, number, created_at from gameweeks where league_id = p_league_id order by number desc;
$$;

create or replace function get_fixtures(p_gameweek_ids uuid[])
returns table(id uuid, gameweek_id uuid, home text, away text, kickoff timestamptz, odds_home numeric, odds_draw numeric, odds_away numeric, result text, created_at timestamptz)
language sql
security definer
as $$
  select id, gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result, created_at
  from fixtures where gameweek_id = any(p_gameweek_ids) order by created_at;
$$;

create or replace function get_predictions(p_fixture_ids uuid[])
returns table(id uuid, fixture_id uuid, member_name text, pick text, created_at timestamptz)
language sql
security definer
as $$
  select id, fixture_id, member_name, pick, created_at from predictions where fixture_id = any(p_fixture_ids);
$$;

grant execute on function get_league_by_code(text) to anon, authenticated;
grant execute on function get_members(uuid) to anon, authenticated;
grant execute on function get_gameweeks(uuid) to anon, authenticated;
grant execute on function get_fixtures(uuid[]) to anon, authenticated;
grant execute on function get_predictions(uuid[]) to anon, authenticated;

-- Leagues insert stays open (creating a league needs no prior secret to
-- know) — only reads and every other write are now gated.
