-- Migration 030 — Enable Supabase Realtime for requests table.
-- Ensures postgres_changes subscriptions receive UPDATE events
-- when provider advances request status (en_route, arrived, etc.).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;
  END IF;
END $$;
