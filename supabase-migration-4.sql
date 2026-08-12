-- Punt Master — migration 4
-- Belt & braces on top of migration 3: even if some future bit of app code
-- accidentally does select('*') on leagues, Postgres itself now refuses to
-- hand back admin_pin_hash to anon/authenticated clients — it's not just
-- the app choosing not to ask for it.

revoke select (admin_pin_hash) on leagues from anon, authenticated;
