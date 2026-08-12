-- Punt Master — migration 6
-- Adds password-protected player accounts — no email, just a name + password
-- per league. Two things this fixes:
--
-- 1. Right now, joining a league just means typing any name — nothing stops
--    someone typing an existing player's name and appearing as them, and the
--    predictions table's insert/update policies only ever checked the kickoff
--    lock, not identity. Anyone with the public anon key (which is public in
--    any deployed app) could already insert a pick under any member_name.
--    submit_prediction() below closes that: every pick now requires the
--    matching password, checked server-side, same pattern as the admin PIN.
--
-- 2. Adds last_active_at so the app can flag long-inactive players without
--    ever deleting their history — no destructive cleanup, just a display
--    flag computed from this column.

alter table members add column if not exists password_hash text;
alter table members add column if not exists last_active_at timestamptz;

-- Predictions could previously be written by anyone who knew a fixture id,
-- regardless of whose name they typed — replaced by password-gated writes.
drop policy if exists "insert prediction before lock" on predictions;
drop policy if exists "update prediction before lock" on predictions;

-- Members could previously be inserted directly (open policy) — joining now
-- always goes through member_join(), which hashes the password server-side.
drop policy if exists "public insert members" on members;

-- Creates a new player in a league, or — if the name already exists — logs
-- them back in on a new device/tab, provided the password matches. Existing
-- rows created before this migration (no password set yet) get to claim
-- their name with whatever password they set the first time they call this.
create or replace function member_join(p_league_id uuid, p_name text, p_team text, p_password text)
returns members
language plpgsql
security definer
as $$
declare
  existing members;
  new_member members;
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

  insert into members (league_id, name, team, password_hash, last_active_at)
  values (p_league_id, p_name, p_team, crypt(p_password, gen_salt('bf')), now())
  returning * into new_member;
  return new_member;
end;
$$;

-- The only way a prediction can now be written — checks the player's
-- password AND the 5-minute lock, in the database, every time.
create or replace function submit_prediction(p_league_id uuid, p_name text, p_password text, p_fixture_id uuid, p_pick text)
returns predictions
language plpgsql
security definer
as $$
declare
  mem members;
  fx fixtures;
  new_pred predictions;
begin
  select * into mem from members where league_id = p_league_id and name = p_name;
  if mem.id is null or mem.password_hash is null or mem.password_hash <> crypt(p_password, mem.password_hash) then
    raise exception 'Incorrect password';
  end if;

  select * into fx from fixtures where id = p_fixture_id;
  if fx.id is null then
    raise exception 'Fixture not found';
  end if;
  if fx.result is not null or (fx.kickoff is not null and now() >= fx.kickoff - interval '5 minutes') then
    raise exception 'Picks are locked for this fixture';
  end if;

  update members set last_active_at = now() where id = mem.id;

  insert into predictions (fixture_id, member_name, pick)
  values (p_fixture_id, p_name, p_pick)
  on conflict (fixture_id, member_name) do update set pick = excluded.pick
  returning * into new_pred;
  return new_pred;
end;
$$;

grant execute on function member_join(uuid, text, text, text) to anon, authenticated;
grant execute on function submit_prediction(uuid, text, text, uuid, text) to anon, authenticated;

-- Same column-level lock as the admin PIN hash — even a select('*') can
-- never return password_hash to a browser.
revoke select (password_hash) on members from anon, authenticated;
