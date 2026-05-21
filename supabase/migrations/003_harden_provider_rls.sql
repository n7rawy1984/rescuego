DROP POLICY IF EXISTS "Providers update own data" ON providers;
DROP POLICY IF EXISTS "Users update own data" ON users;

-- Provider profile mutations are handled by authenticated server routes using
-- the service role. This prevents a browser client from self-activating,
-- changing plan tiers, or awarding itself a verified badge.
--
-- User profile mutations are also handled by authenticated server routes using
-- the service role. This prevents browser clients from changing their own role.
