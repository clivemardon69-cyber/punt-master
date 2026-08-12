-- Punt Master — migration 2
-- Adds kickoff time (powers the 5-minute lock and Manager of the Month)
-- and an optional favourite team on members (powers personalisation).
-- Only adds columns — safe to run on your existing database, your
-- test league and data stay intact.

alter table fixtures add column if not exists kickoff timestamptz;
alter table members add column if not exists team text;
