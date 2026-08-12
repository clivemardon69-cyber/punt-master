-- Punt Master — migration 8
-- Swaps the inactivity rule from "6 calendar weeks" to "8 gameweeks since
-- your last submitted prediction" — ties it to games actually missed rather
-- than the clock, so international breaks or a quiet fortnight can't
-- accidentally archive someone through no fault of their own.
--
-- Needs to know which gameweek a player was at when they joined, so a brand
-- new player gets their own full 8-round grace period rather than being
-- compared against gameweek zero.

alter table members add column if not exists joined_gameweek_number int not null default 0;

-- Re-created so a NEW member also records the league's current gameweek
-- number at the moment they join. Existing members keep whatever's already
-- in joined_gameweek_number (0, from the default above) — a slightly
-- generous fallback for accounts created before this migration.
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
    if existing.password_hash <> crypt(p_password, existing.password_hash) then
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

grant execute on function member_join(uuid, text, text, text) to anon, authenticated;

-- get_members() needs to return the new column too, so the app can compute
-- each player's grace period. It's changing shape (one more column), and
-- Postgres won't let create-or-replace change a function's return columns
-- — the old version has to be dropped first.
drop function if exists get_members(uuid);

create or replace function get_members(p_league_id uuid)
returns table(id uuid, league_id uuid, name text, team text, joined_at timestamptz, last_active_at timestamptz, joined_gameweek_number int)
language sql
security definer
as $$
  select id, league_id, name, team, joined_at, last_active_at, joined_gameweek_number from members where league_id = p_league_id;
$$;

grant execute on function get_members(uuid) to anon, authenticated;
