-- Migration 030 — Enable Supabase Realtime for requests table.
-- Ensures postgres_changes subscriptions receive UPDATE events
-- when provider advances request status (en_route, arrived, etc.).

ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;
-- Migration 030 — Enable Supabase Realtime for requests table.
-- Ensures postgres_changes subscriptions receive UPDATE events
-- when provider advances request status (en_route, arrived, etc.).

ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;
