-- Punt Master — migration 12
-- Adds admin_rename_member(): fixes a misspelled or mistyped player name
-- without losing anything — unlike admin_remove_member(), this keeps the
-- player's existing picks and points attached, just under the corrected
-- name.

create or replace function admin_rename_member(p_league_id uuid, p_pin text, p_old_name text, p_new_name text)
returns void
language plpgsql
security definer
as $$
declare
  v_new_name text := trim(p_new_name);
begin
  if not check_admin_pin(p_league_id, p_pin) then
    raise exception 'Incorrect admin PIN';
  end if;
  if v_new_name = '' then
    raise exception 'New name cannot be empty';
  end if;
  if exists (select 1 from members where league_id = p_league_id and name = v_new_name and name <> p_old_name) then
    raise exception 'Someone in this league already has that name';
  end if;
  update members set name = v_new_name where league_id = p_league_id and name = p_old_name;
  update predictions set member_name = v_new_name
  where member_name = p_old_name
    and fixture_id in (
      select f.id from fixtures f
      join gameweeks g on g.id = f.gameweek_id
      where g.league_id = p_league_id
    );
end;
$$;

grant execute on function admin_rename_member(uuid, text, text, text) to anon, authenticated;
