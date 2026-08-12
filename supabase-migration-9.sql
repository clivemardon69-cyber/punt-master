-- Punt Master — migration 9
-- Three fixes prompted by a "what's still missing before this goes out"
-- review: a server-side sanity check on odds (so a typo like 20 instead of
-- 2.0 can't silently wreck a gameweek's scoring even if someone calls the
-- API directly, not just through the app's own validation), and two admin
-- tools that didn't exist yet — deleting a wrongly entered fixture, and
-- removing a member (frees up their name, deletes their picks) — both
-- needed now that people other than the original admin may end up running
-- their own leagues without direct database access to fix mistakes.

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
-- up entirely — for fixing mistakes (wrong person, duplicate name claimed
-- by the wrong person), not for pruning quiet-but-legitimate players
-- (that's what the 8-round inactive flag is for, and it never deletes
-- anything).
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

grant execute on function admin_add_fixture(uuid, text, uuid, text, text, timestamptz, numeric, numeric, numeric) to anon, authenticated;
grant execute on function admin_delete_fixture(uuid, text, uuid) to anon, authenticated;
grant execute on function admin_remove_member(uuid, text, text) to anon, authenticated;
