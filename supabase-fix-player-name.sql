-- Punt Master — fixes "Abert" to "Albert" in league M2XEP, keeping all of
-- their existing picks and points attached to the corrected name.
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

  update members set name = 'Albert' where league_id = v_league_id and name = 'Abert';

  update predictions set member_name = 'Albert'
  where member_name = 'Abert'
    and fixture_id in (
      select f.id from fixtures f
      join gameweeks g on g.id = f.gameweek_id
      where g.league_id = v_league_id
    );

end $$;
