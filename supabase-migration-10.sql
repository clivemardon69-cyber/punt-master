-- Punt Master — migration 10
-- Closes a gap flagged during a final security review: nothing stopped
-- repeated password or PIN guesses against a name/league that's known to
-- exist. Adds a simple lockout — 5 wrong attempts locks that specific
-- member (or that league's admin PIN) out for 15 minutes, tracked in the
-- database, reset automatically on the next correct attempt. No app code
-- changes needed — the lockout message flows through the same error
-- handling already used for "Incorrect password" / "Incorrect admin PIN".

alter table members add column if not exists failed_attempts int not null default 0;
alter table members add column if not exists locked_until timestamptz;

alter table leagues add column if not exists pin_failed_attempts int not null default 0;
alter table leagues add column if not exists pin_locked_until timestamptz;

-- Shared by member_join() and submit_prediction() wherever a member's
-- password is actually checked against an existing account.
create or replace function check_member_login(p_member_id uuid, p_password text)
returns boolean
language plpgsql
security definer
as $$
declare
  mem members;
  ok boolean;
begin
  select * into mem from members where id = p_member_id;
  if mem.id is null then
    return false;
  end if;

  if mem.locked_until is not null and now() < mem.locked_until then
    raise exception 'Too many wrong attempts for this name. Try again in a few minutes.';
  end if;

  ok := mem.password_hash is not null and mem.password_hash = crypt(p_password, mem.password_hash);

  if ok then
    update members set failed_attempts = 0, locked_until = null where id = mem.id;
    return true;
  else
    if mem.failed_attempts + 1 >= 5 then
      update members set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = mem.id;
    else
      update members set failed_attempts = mem.failed_attempts + 1 where id = mem.id;
    end if;
    return false;
  end if;
end;
$$;

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
    if not check_member_login(existing.id, p_password) then
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
  if mem.id is null or mem.password_hash is null then
    raise exception 'Incorrect password';
  end if;
  if not check_member_login(mem.id, p_password) then
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

-- Same idea for the admin PIN — same signature/return type, so this is a
-- straight replace, no drop needed.
create or replace function check_admin_pin(p_league_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
as $$
declare
  lg leagues;
  ok boolean;
begin
  select * into lg from leagues where id = p_league_id;
  if lg.id is null then
    return false;
  end if;

  if lg.pin_locked_until is not null and now() < lg.pin_locked_until then
    raise exception 'Too many wrong PIN attempts. Try again in a few minutes.';
  end if;

  ok := lg.admin_pin_hash is not null and lg.admin_pin_hash = crypt(p_pin, lg.admin_pin_hash);

  if ok then
    update leagues set pin_failed_attempts = 0, pin_locked_until = null where id = lg.id;
    return true;
  else
    if lg.pin_failed_attempts + 1 >= 5 then
      update leagues set pin_failed_attempts = 0, pin_locked_until = now() + interval '15 minutes' where id = lg.id;
    else
      update leagues set pin_failed_attempts = lg.pin_failed_attempts + 1 where id = lg.id;
    end if;
    return false;
  end if;
end;
$$;

grant execute on function member_join(uuid, text, text, text) to anon, authenticated;
grant execute on function submit_prediction(uuid, text, text, uuid, text) to anon, authenticated;
grant execute on function check_admin_pin(uuid, text) to anon, authenticated;
