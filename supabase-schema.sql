-- Punt Master — database schema
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run

create extension if not exists "pgcrypto";

create table leagues (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  admin_name text not null,
  admin_pin_hash text, -- set via set_admin_pin() at creation; gates fixture/result writes
  pin_failed_attempts int not null default 0, -- brute-force lockout, see check_admin_pin()
  pin_locked_until timestamptz,
  created_at timestamptz default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  name text not null,
  team text, -- optional favourite Premier League club
  password_hash text, -- set via member_join(); no email is ever collected
  failed_attempts int not null default 0, -- brute-force lockout, see check_member_login()
  locked_until timestamptz,
  last_active_at timestamptz,
  joined_gameweek_number int not null default 0, -- for the 8-round inactivity grace period
  joined_at timestamptz default now(),
  unique(league_id, name)
);

create table gameweeks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  number int not null,
  created_at timestamptz default now(),
  unique(league_id, number)
);

create table fixtures (
  id uuid primary key default gen_random_uuid(),
  gameweek_id uuid references gameweeks(id) on delete cascade,
  home text not null,
  away text not null,
  kickoff timestamptz, -- predictions lock 5 minutes before this
  odds_home numeric not null,
  odds_draw numeric not null,
  odds_away numeric not null,
  result text check (result in ('H','D','A') or result is null),
  created_at timestamptz default now()
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid references fixtures(id) on delete cascade,
  member_name text not null,
  pick text not null check (pick in ('H','D','A')),
  created_at timestamptz default now(),
  unique(fixture_id, member_name)
);

-- Row Level Security: nothing is readable or writable directly through the
-- public API except creating a brand-new league (which needs no prior
-- secret). Every other read and write — joining, logging in, picks,
-- fixtures, results, gameweeks — only happens through the functions further
-- down this file, each of which checks a code or password before returning
-- or changing anything. This means data can only be reached by already
-- knowing a real league code (or an ID chained from one), not by querying
-- the tables directly.

alter table leagues enable row level security;
alter table members enable row level security;
alter table gameweeks enable row level security;
alter table fixtures enable row level security;
alter table predictions enable row level security;

create policy "public insert leagues" on leagues for insert with check (true);

-- ============================================================
-- Hard admin lock — PIN set once at league creation (hashed with
-- pgcrypto), checked inside these functions. This is the ONLY way
-- fixtures, gameweeks, and results can be written.
-- ============================================================

create or replace function set_admin_pin(p_league_id uuid, p_pin text)
returns void
language plpgsql
security definer
as $$
begin
  update leagues
  set admin_pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_league_id and admin_pin_hash is null;
end;
$$;

create or replace function check_admin_pin(p_league_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
as $$
declare
  lg leagues;
  ok boolean;
begin
  select * into lg from leagues where id = p_league_id;
  if lg.id is null then
    return false;
  end if;

  if lg.pin_locked_until is not null and now() < lg.pin_locked_until then
    raise exception 'Too many wrong PIN attempts. Try again in a few minutes.';
  end if;

  ok := lg.admin_pin_hash is not null and lg.admin_pin_hash = crypt(p_pin, lg.admin_pin_hash);

  if ok then
    update leagues set pin_failed_attempts = 0, pin_locked_until = null where id = lg.id;
    return true;
  else
    if lg.pin_failed_attempts + 1 >= 5 then
      update leagues set pin_failed_attempts = 0, pin_locked_until = now() + interval '15 minutes' where id = lg.id;
    else
      update leagues set pin_failed_attempts = lg.pin_failed_attempts + 1 where id = lg.id;
    end if;
    return false;
  end if;
end;
$$;

create or replace function admin_new_gameweek(p_league_id uuid, p_pin text, p_number int)
returns gameweeks
language plpgsql
security definer
as $$
declare
  new_gw gameweeks;
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  insert into gameweeks (league_id, number) values (p_league_id, p_number)
  returning * into new_gw;
  return new_gw;
end;
$$;

create or replace function admin_add_fixture(
  p_league_id uuid, p_pin text, p_gameweek_id uuid,
  p_home text, p_away text, p_kickoff timestamptz,
  p_odds_home numeric, p_odds_draw numeric, p_odds_away numeric
)
returns fixtures
language plpgsql
security definer
as $$
declare
  new_fixture fixtures;
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  if p_odds_home < 1.01 or p_odds_home > 50
     or p_odds_draw < 1.01 or p_odds_draw > 50
     or p_odds_away < 1.01 or p_odds_away > 50 then
    raise exception 'Odds should each be between 1.01 and 50';
  end if;
  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away)
  values (p_gameweek_id, p_home, p_away, p_kickoff, p_odds_home, p_odds_draw, p_odds_away)
  returning * into new_fixture;
  return new_fixture;
end;
$$;

-- Deletes a fixture and (via the existing cascade) everyone's picks for it.
create or replace function admin_delete_fixture(p_league_id uuid, p_pin text, p_fixture_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  delete from fixtures
  where id = p_fixture_id
    and gameweek_id in (select id from gameweeks where league_id = p_league_id);
end;
$$;

-- Removes a member from a league and deletes their picks, freeing the name
-- up entirely — for fixing mistakes, not for pruning quiet-but-legitimate
-- players (that's what the 8-round inactive flag is for, and it never
-- deletes anything).
create or replace function admin_remove_member(p_league_id uuid, p_pin text, p_member_name text)
returns void
language plpgsql
security definer
as $$
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  delete from predictions
  where member_name = p_member_name
    and fixture_id in (
      select f.id from fixtures f
      join gameweeks g on g.id = f.gameweek_id
      where g.league_id = p_league_id
    );
  delete from members where league_id = p_league_id and name = p_member_name;
end;
$$;

create or replace function admin_set_result(p_league_id uuid, p_pin text, p_fixture_id uuid, p_result text)
returns void
language plpgsql
security definer
as $$
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  update fixtures set result = p_result where id = p_fixture_id;
end;
$$;

grant execute on function set_admin_pin(uuid, text) to anon, authenticated;
grant execute on function check_admin_pin(uuid, text) to anon, authenticated;
grant execute on function admin_new_gameweek(uuid, text, int) to anon, authenticated;
grant execute on function admin_add_fixture(uuid, text, uuid, text, text, timestamptz, numeric, numeric, numeric) to anon, authenticated;
grant execute on function admin_set_result(uuid, text, uuid, text) to anon, authenticated;
grant execute on function admin_delete_fixture(uuid, text, uuid) to anon, authenticated;
grant execute on function admin_remove_member(uuid, text, text) to anon, authenticated;

-- Column-level lock: even a select('*') from the app can never return the
-- PIN hash to a browser. check_admin_pin() can still read it internally
-- because SECURITY DEFINER functions run with the function owner's
-- privileges, not the caller's.
revoke select (admin_pin_hash) on leagues from anon, authenticated;

-- ============================================================
-- Player accounts — a name + password per league, no email ever
-- collected. member_join() both creates new players and logs returning
-- ones back in on a new device (password must match an existing name).
-- submit_prediction() is the only way a pick can be written, and checks
-- the password plus the 5-minute lock together, in the database.
-- ============================================================

-- Shared by member_join() and submit_prediction() wherever a member's
-- password is checked against an existing account — tracks failed
-- attempts and locks that member out for 15 minutes after 5 wrong guesses.
create or replace function check_member_login(p_member_id uuid, p_password text)
returns boolean
language plpgsql
security definer
as $$
declare
  mem members;
  ok boolean;
begin
  select * into mem from members where id = p_member_id;
  if mem.id is null then
    return false;
  end if;

  if mem.locked_until is not null and now() < mem.locked_until then
    raise exception 'Too many wrong attempts for this name. Try again in a few minutes.';
  end if;

  ok := mem.password_hash is not null and mem.password_hash = crypt(p_password, mem.password_hash);

  if ok then
    update members set failed_attempts = 0, locked_until = null where id = mem.id;
    return true;
  else
    if mem.failed_attempts + 1 >= 5 then
      update members set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = mem.id;
    else
      update members set failed_attempts = mem.failed_attempts + 1 where id = mem.id;
    end if;
    return false;
  end if;
end;
$$;

create or replace function member_join(p_league_id uuid, p_name text, p_team text, p_password text)
returns members
language plpgsql
security definer
as $$
declare
  existing members;
  new_member members;
  current_gw_number int;
begin
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;

  select * into existing from members where league_id = p_league_id and name = p_name;

  if existing.id is not null then
    if existing.password_hash is null then
      update members
      set password_hash = crypt(p_password, gen_salt('bf')), team = coalesce(p_team, team), last_active_at = now()
      where id = existing.id
      returning * into new_member;
      return new_member;
    end if;
    if not check_member_login(existing.id, p_password) then
      raise exception 'That name is already taken in this league. Log in with its password, or choose a different name.';
    end if;
    update members set team = coalesce(p_team, team), last_active_at = now()
    where id = existing.id
    returning * into new_member;
    return new_member;
  end if;

  select coalesce(max(number), 0) into current_gw_number from gameweeks where league_id = p_league_id;

  insert into members (league_id, name, team, password_hash, last_active_at, joined_gameweek_number)
  values (p_league_id, p_name, p_team, crypt(p_password, gen_salt('bf')), now(), current_gw_number)
  returning * into new_member;
  return new_member;
end;
$$;

create or replace function submit_prediction(p_league_id uuid, p_name text, p_password text, p_fixture_id uuid, p_pick text)
returns predictions
language plpgsql
security definer
as $$
declare
  mem members;
  fx fixtures;
  new_pred predictions;
begin
  select * into mem from members where league_id = p_league_id and name = p_name;
  if mem.id is null or mem.password_hash is null then
    raise exception 'Incorrect password';
  end if;
  if not check_member_login(mem.id, p_password) then
    raise exception 'Incorrect password';
  end if;

  select * into fx from fixtures where id = p_fixture_id;
  if fx.id is null then
    raise exception 'Fixture not found';
  end if;
  if fx.result is not null or (fx.kickoff is not null and now() >= fx.kickoff - interval '5 minutes') then
    raise exception 'Picks are locked for this fixture';
  end if;

  update members set last_active_at = now() where id = mem.id;

  insert into predictions (fixture_id, member_name, pick)
  values (p_fixture_id, p_name, p_pick)
  on conflict (fixture_id, member_name) do update set pick = excluded.pick
  returning * into new_pred;
  return new_pred;
end;
$$;

grant execute on function member_join(uuid, text, text, text) to anon, authenticated;
grant execute on function submit_prediction(uuid, text, text, uuid, text) to anon, authenticated;

-- Same column-level lock as the admin PIN hash — even a select('*') can
-- never return password_hash to a browser.
revoke select (password_hash) on members from anon, authenticated;

-- ============================================================
-- Reads — same principle as the writes above: nothing comes back unless
-- you already have a real code or ID. These run as the function owner
-- (SECURITY DEFINER), so they can see the tables even though the tables
-- themselves have no select policy for anon/authenticated.
-- ============================================================

create or replace function get_league_by_code(p_code text)
returns table(id uuid, code text, name text, admin_name text, created_at timestamptz)
language sql
security definer
as $$
  select id, code, name, admin_name, created_at from leagues where code = p_code;
$$;

create or replace function get_members(p_league_id uuid)
returns table(id uuid, league_id uuid, name text, team text, joined_at timestamptz, last_active_at timestamptz, joined_gameweek_number int)
language sql
security definer
as $$
  select id, league_id, name, team, joined_at, last_active_at, joined_gameweek_number from members where league_id = p_league_id;
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
