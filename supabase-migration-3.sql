-- Punt Master — migration 3: hard admin lock
-- Replaces the soft, UI-only admin gate with real database enforcement.
-- Each league gets a PIN (set once, at creation) hashed with pgcrypto.
-- Adding fixtures, entering results, and starting gameweeks now only work
-- through the functions below, which check the PIN themselves — direct
-- table writes for fixtures/gameweeks are switched off entirely, so there
-- is no way to make these changes without knowing the correct PIN, even
-- for someone calling the API directly.

alter table leagues add column if not exists admin_pin_hash text;

drop policy if exists "public insert gameweeks" on gameweeks;
drop policy if exists "public insert fixtures" on fixtures;
drop policy if exists "public update fixtures" on fixtures;

-- Sets a league's PIN. Only works once — while admin_pin_hash is still
-- null — so nobody can silently overwrite an existing PIN.
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
  ok boolean;
begin
  select (admin_pin_hash is not null and admin_pin_hash = crypt(p_pin, admin_pin_hash))
  into ok
  from leagues where id = p_league_id;
  return coalesce(ok, false);
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
  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away)
  values (p_gameweek_id, p_home, p_away, p_kickoff, p_odds_home, p_odds_draw, p_odds_away)
  returning * into new_fixture;
  return new_fixture;
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
