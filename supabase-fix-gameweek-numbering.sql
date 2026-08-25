-- Punt Master — moves Gameweek 8's fixtures (and odds) into Gameweek 2,
-- then deletes the accidental empty Gameweeks 3 through 8 in between.
-- Scoped to league M2XEP. Read through before running — irreversible.
--
-- Any predictions already made on Gameweek 8's fixtures move with them
-- automatically (predictions are tied to the fixture, not the gameweek).
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

do $$
declare
  v_league_id uuid;
  v_gw2_id uuid;
  v_gw8_id uuid;
begin
  select id into v_league_id from leagues where code = 'M2XEP';
  if v_league_id is null then
    raise exception 'League M2XEP not found';
  end if;

  select id into v_gw2_id from gameweeks where league_id = v_league_id and number = 2;
  if v_gw2_id is null then
    raise exception 'Gameweek 2 not found';
  end if;

  select id into v_gw8_id from gameweeks where league_id = v_league_id and number = 8;
  if v_gw8_id is null then
    raise exception 'Gameweek 8 not found';
  end if;

  -- Move the fixtures (with their odds) from 8 into 2.
  update fixtures set gameweek_id = v_gw2_id where gameweek_id = v_gw8_id;

  -- Now safe to delete 3 through 8 — 8 is empty since its fixtures just
  -- moved out, and 3-7 should already have no fixtures of their own.
  delete from gameweeks where league_id = v_league_id and number between 3 and 8;

end $$;
