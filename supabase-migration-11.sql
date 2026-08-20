-- Punt Master — migration 11
-- Adds admin_rename_league(): lets a league's own admin fix a typo'd or
-- accidental league name themselves. The only other way to change it is
-- direct database access, which only the app owner has — not every
-- friend who's started their own league through the app.

create or replace function admin_rename_league(p_league_id uuid, p_pin text, p_name text)
returns void
language plpgsql
security definer
as $$
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'League name cannot be empty';
  end if;
  update leagues set name = trim(p_name) where id = p_league_id;
end;
$$;

grant execute on function admin_rename_league(uuid, text, text) to anon, authenticated;
