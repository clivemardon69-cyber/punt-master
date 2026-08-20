-- Punt Master — clean up test/fictitious data from league M2XEP before
-- sending it out to friends and family. Read through before running —
-- this is irreversible.
--
-- Removes:
--  - The backdated test gameweeks (and their fixtures, results, and
--    picks) added by supabase-seed-test-data.sql
--  - The four fictitious players (Priya, Tom, Alex, Jamie) added by
--    supabase-seed-fake-players.sql, and any of their picks
--  - The "Berliner Kindl" member row left over from an earlier mix-up
--    (a dictation slip that accidentally created a player using the same
--    name as the league itself), and any of their picks
--
-- Keeps: Gameweek 1 exactly as you built it manually, and every other
-- real member (including your own admin account) untouched.
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

do $$
declare
  v_league_id uuid;
begin
  select id into v_league_id from leagues where code = 'M2XEP';
  if v_league_id is null then
    raise exception 'League M2XEP not found';
  end if;

  -- Backdated test gameweeks and everything on them — fixtures cascade
  -- from gameweeks, predictions cascade from fixtures. Keeps Gameweek 1.
  delete from gameweeks where league_id = v_league_id and number <> 1;

  -- Fictitious players and the erroneous "Berliner Kindl" entry, plus
  -- any stray picks of theirs that might exist on Gameweek 1 itself.
  delete from predictions
  where member_name in ('Priya', 'Tom', 'Alex', 'Jamie', 'Berliner Kindl')
    and fixture_id in (
      select f.id from fixtures f
      join gameweeks g on g.id = f.gameweek_id
      where g.league_id = v_league_id
    );

  delete from members
  where league_id = v_league_id
    and name in ('Priya', 'Tom', 'Alex', 'Jamie', 'Berliner Kindl');

end $$;
