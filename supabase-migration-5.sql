-- Punt Master — migration 5
-- The 5-minute-before-kickoff lock was only ever enforced in the app's UI —
-- the "Enter all three odds" / disabled-button check. Nothing stopped
-- someone calling the API directly from submitting or changing a pick
-- after that point, even after seeing the result. This makes the database
-- itself refuse it, regardless of what calls it.

drop policy if exists "public insert predictions" on predictions;
drop policy if exists "public update predictions" on predictions;

create policy "insert prediction before lock" on predictions for insert
  with check (
    exists (
      select 1 from fixtures f
      where f.id = fixture_id
        and (f.kickoff is null or now() < f.kickoff - interval '5 minutes')
    )
  );

create policy "update prediction before lock" on predictions for update
  using (
    exists (
      select 1 from fixtures f
      where f.id = predictions.fixture_id
        and (f.kickoff is null or now() < f.kickoff - interval '5 minutes')
    )
  );
