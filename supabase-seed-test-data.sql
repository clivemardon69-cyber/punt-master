-- Punt Master — seed a few extra "past" gameweeks with fixtures, results,
-- and picks for every current member of league M2XEP. Purely so you can
-- see the Standings tab and the Gameweek badges (streak, accuracy, risk
-- profile) working with real history behind them, without clicking
-- through the Admin tab by hand a dozen times.
--
-- Safe to run: everything is scoped to the league code below and wrapped
-- in one block, so it either all applies or nothing does.
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
--
-- Heads up: this adds new, higher-numbered gameweeks, so the app's
-- "current" gameweek (always the highest number) will point at the
-- newest one added here instead of your real Gameweek 1 — just pick
-- "Gameweek 1" from the dropdown in the Gameweek tab to get back to your
-- actual upcoming fixtures. Nothing about Gameweek 1 itself is touched.
--
-- Delete this file whenever you're done with it — it's a one-off test
-- helper, not part of the app.

do $$
declare
  v_league_id uuid;
  v_gw1 uuid;
  v_gw2 uuid;
  v_gw3 uuid;
  v_next_gw int;
  v_fx uuid;
begin
  select id into v_league_id from leagues where code = 'M2XEP';
  if v_league_id is null then
    raise exception 'League M2XEP not found — check the code at the top of this script';
  end if;

  select coalesce(max(number), 0) + 1 into v_next_gw from gameweeks where league_id = v_league_id;

  -- ============ Gameweek (3 weeks ago) ============
  insert into gameweeks (league_id, number) values (v_league_id, v_next_gw) returning id into v_gw1;

  -- Everyone picks the home side, result goes the other way — a deliberate
  -- old miss, so there's a "wall" for the streak to stop at further down.
  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw1, 'Arsenal', 'Chelsea', now() - interval '21 days', 1.9, 3.6, 4.2, 'A') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  -- These two kick off at the exact same time — a real test of the
  -- "grouped by kick-off moment" streak logic, both picked correctly.
  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw1, 'Man City', 'Everton', now() - interval '21 days' + interval '2 hours', 1.3, 5.5, 9.0, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw1, 'Liverpool', 'Fulham', now() - interval '21 days' + interval '2 hours', 1.5, 4.3, 6.5, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  -- ============ Gameweek (2 weeks ago) ============
  insert into gameweeks (league_id, number) values (v_league_id, v_next_gw + 1) returning id into v_gw2;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw2, 'Newcastle', 'Brighton', now() - interval '14 days', 1.7, 3.8, 4.8, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  -- Another simultaneous kick-off pair, both correct.
  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw2, 'Tottenham', 'Brentford', now() - interval '14 days' + interval '3 hours', 1.6, 4.0, 5.5, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw2, 'Man United', 'Leeds', now() - interval '14 days' + interval '3 hours', 1.4, 4.4, 7.0, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  -- ============ Gameweek (1 week ago, most recent) ============
  insert into gameweeks (league_id, number) values (v_league_id, v_next_gw + 2) returning id into v_gw3;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw3, 'Aston Villa', 'Sunderland', now() - interval '7 days', 1.6, 4.0, 5.8, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw3, 'Crystal Palace', 'Ipswich', now() - interval '7 days' + interval '2 hours', 1.8, 3.5, 4.5, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

  insert into fixtures (gameweek_id, home, away, kickoff, odds_home, odds_draw, odds_away, result)
  values (v_gw3, 'Bournemouth', 'Hull City', now() - interval '7 days' + interval '4 hours', 1.5, 4.2, 6.8, 'H') returning id into v_fx;
  insert into predictions (fixture_id, member_name, pick)
  select v_fx, m.name, 'H' from members m where m.league_id = v_league_id;

end $$;
