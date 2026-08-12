-- Punt Master — reset script
-- Wipes the tables from supabase-schema.sql so you can start clean.
-- Run this FIRST in Supabase SQL Editor, then run supabase-schema.sql again straight after.

drop table if exists predictions cascade;
drop table if exists fixtures    cascade;
drop table if exists gameweeks   cascade;
drop table if exists members     cascade;
drop table if exists leagues     cascade;
