-- Punt Master — add four fictitious players to league M2XEP, with picks
-- on the 9 backdated test fixtures from supabase-seed-test-data.sql, so
-- the Standings tab shows a proper spread of players rather than just
-- you. Run supabase-seed-test-data.sql FIRST — this depends on those
-- fixtures already existing.
--
-- Deliberately scoped to only the 9 backdated test fixtures, not your
-- real Gameweek 1 — so nothing here can accidentally affect scoring once
-- the real season kicks off.
--
-- Each fake player gets a real password (puntmaster1) in case you want
-- to sign in as one of them and poke around from their point of view —
-- their name, that password, and league code M2XEP is all you need.
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Delete this file whenever you're done with it — one-off test helper,
-- not part of the app.

do $$
declare
  v_league_id uuid;
begin
  select id into v_league_id from leagues where code = 'M2XEP';
  if v_league_id is null then
    raise exception 'League M2XEP not found — check the code at the top of this script';
  end if;

  insert into members (league_id, name, team, password_hash)
  values
    (v_league_id, 'Priya', 'Liverpool', crypt('puntmaster1', gen_salt('bf'))),
    (v_league_id, 'Tom', 'Man United', crypt('puntmaster1', gen_salt('bf'))),
    (v_league_id, 'Alex', 'Chelsea', crypt('puntmaster1', gen_salt('bf'))),
    (v_league_id, 'Jamie', 'Newcastle', crypt('puntmaster1', gen_salt('bf')))
  on conflict (league_id, name) do nothing;

  -- Priya: sharp — gets all 9 right. Tom: middling, mostly backs
  -- favourites. Alex: has a rough week. Jamie: chases the odds and lands
  -- one big underdog — enough to average out as "The Underdog Hunter".
  insert into predictions (fixture_id, member_name, pick)
  select f.id, v.member_name, v.pick
  from (values
    ('Arsenal', 'Chelsea', 'Priya', 'A'),
    ('Arsenal', 'Chelsea', 'Tom', 'D'),
    ('Arsenal', 'Chelsea', 'Alex', 'H'),
    ('Arsenal', 'Chelsea', 'Jamie', 'A'),
    ('Man City', 'Everton', 'Priya', 'H'),
    ('Man City', 'Everton', 'Tom', 'H'),
    ('Man City', 'Everton', 'Alex', 'A'),
    ('Man City', 'Everton', 'Jamie', 'D'),
    ('Liverpool', 'Fulham', 'Priya', 'H'),
    ('Liverpool', 'Fulham', 'Tom', 'A'),
    ('Liverpool', 'Fulham', 'Alex', 'D'),
    ('Liverpool', 'Fulham', 'Jamie', 'A'),
    ('Newcastle', 'Brighton', 'Priya', 'H'),
    ('Newcastle', 'Brighton', 'Tom', 'H'),
    ('Newcastle', 'Brighton', 'Alex', 'A'),
    ('Newcastle', 'Brighton', 'Jamie', 'D'),
    ('Tottenham', 'Brentford', 'Priya', 'H'),
    ('Tottenham', 'Brentford', 'Tom', 'D'),
    ('Tottenham', 'Brentford', 'Alex', 'H'),
    ('Tottenham', 'Brentford', 'Jamie', 'H'),
    ('Man United', 'Leeds', 'Priya', 'H'),
    ('Man United', 'Leeds', 'Tom', 'H'),
    ('Man United', 'Leeds', 'Alex', 'D'),
    ('Man United', 'Leeds', 'Jamie', 'A'),
    ('Aston Villa', 'Sunderland', 'Priya', 'H'),
    ('Aston Villa', 'Sunderland', 'Tom', 'A'),
    ('Aston Villa', 'Sunderland', 'Alex', 'D'),
    ('Aston Villa', 'Sunderland', 'Jamie', 'H'),
    ('Crystal Palace', 'Ipswich', 'Priya', 'H'),
    ('Crystal Palace', 'Ipswich', 'Tom', 'H'),
    ('Crystal Palace', 'Ipswich', 'Alex', 'A'),
    ('Crystal Palace', 'Ipswich', 'Jamie', 'D'),
    ('Bournemouth', 'Hull City', 'Priya', 'H'),
    ('Bournemouth', 'Hull City', 'Tom', 'D'),
    ('Bournemouth', 'Hull City', 'Alex', 'H'),
    ('Bournemouth', 'Hull City', 'Jamie', 'A')
  ) as v(home, away, member_name, pick)
  join fixtures f on f.home = v.home and f.away = v.away
  join gameweeks g on g.id = f.gameweek_id and g.league_id = v_league_id
  on conflict (fixture_id, member_name) do nothing;

end $$;
