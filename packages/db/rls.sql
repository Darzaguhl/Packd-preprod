-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — Packd
--
-- HOW TO APPLY
-- Paste this entire file into the Supabase SQL editor and run it.
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE where possible.
--
-- WHAT THIS DOES
-- Enables RLS on every table so that the Supabase auto-generated REST API
-- (PostgREST), direct Supabase client queries, and Supabase Studio access
-- by non-superuser roles are all denied by default.
--
-- WHAT THIS DOES NOT DO
-- The Fastify API connects as the `postgres` superuser (DATABASE_URL), which
-- has BYPASSRLS = true. Prisma queries are completely unaffected — no code
-- changes are needed. The API's existing assertStudioAccess() checks remain
-- the enforcement layer for application-level isolation.
--
-- For full DB-level isolation that also covers the API, a separate non-
-- privileged Postgres role + Prisma middleware would be needed (future work).
-- ─────────────────────────────────────────────────────────────────────────────

-- Studio (tenant root)
ALTER TABLE "Studio"             ENABLE ROW LEVEL SECURITY;

-- Studio-scoped tables
ALTER TABLE "StudioIntegration"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Room"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoomLayout"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Station"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassTemplate"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSchedule"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSession"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Instructor"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipPlan"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CancellationPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"            ENABLE ROW LEVEL SECURITY;

-- Member & financial tables
ALTER TABLE "Member"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditBalance"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditTransaction"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipSubscription"  ENABLE ROW LEVEL SECURITY;

-- Auth / user table
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Explicit deny-all policies for the `anon` role (unauthenticated Supabase
-- client requests). Belt-and-suspenders: RLS with no policies already denies
-- everything, but explicit DENY policies make the intent clear and survive
-- future Supabase dashboard defaults changes.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'Studio', 'StudioIntegration', 'Location', 'Room', 'RoomLayout',
    'Station', 'ClassTemplate', 'ClassSchedule', 'ClassSession',
    'Instructor', 'MembershipPlan', 'CancellationPolicy', 'Product',
    'Member', 'Booking', 'WaitlistEntry', 'CreditBalance',
    'CreditTransaction', 'MembershipSubscription', 'User'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "deny_anon" ON %I',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "deny_anon" ON %I AS RESTRICTIVE TO anon USING (false)',
      tbl
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The `authenticated` role (Supabase client with a valid user JWT) is also
-- denied by default (no permissive policies exist). Add policies here if you
-- ever want to allow direct Supabase client queries from the frontend.
-- For now, all data access goes through the Fastify API which uses the
-- `postgres` role and bypasses RLS entirely.
-- ─────────────────────────────────────────────────────────────────────────────
