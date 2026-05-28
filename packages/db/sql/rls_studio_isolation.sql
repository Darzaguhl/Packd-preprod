-- ============================================================
-- RLS Option B — DB-level studio isolation
-- Run once in Supabase SQL Editor (as postgres / service_role).
--
-- Strategy: SOFT bypass — when app.current_studio_id is empty
-- or not set, ALL rows are visible (preserves existing admin/
-- migration queries). When set to a studio ID, only that
-- studio's rows are returned.
--
-- To enforce the context on the service_role connection used by
-- Prisma, each table also gets FORCE ROW LEVEL SECURITY so the
-- policy applies even to the superuser.
-- ============================================================

-- ── Schema + Helper function ─────────────────────────────────
-- Create app schema (used for our helper functions).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app') THEN
    CREATE SCHEMA app;
  END IF;
END$$;

-- Returns the current studio context, or '' if not set.
CREATE OR REPLACE FUNCTION app.current_studio()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.current_studio_id', true), '')
$$;

-- ── Macro to create the isolation policy on a table ──────────
-- Soft bypass: empty context → all rows visible.
-- Non-empty context → only matching studioId rows visible.

-- ─────────────────────────────────────────────────────────────
-- ClassSession
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ClassSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSession" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "ClassSession";
CREATE POLICY studio_isolation ON "ClassSession"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- ClassTemplate
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ClassTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassTemplate" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "ClassTemplate";
CREATE POLICY studio_isolation ON "ClassTemplate"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- ClassSchedule
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ClassSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSchedule" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "ClassSchedule";
CREATE POLICY studio_isolation ON "ClassSchedule"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- Member
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "Member";
CREATE POLICY studio_isolation ON "Member"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- Booking  (join table — isolation via session.studioId)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "Booking";
CREATE POLICY studio_isolation ON "Booking"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "ClassSession" s
      WHERE s.id = "Booking"."sessionId"
        AND s."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- WaitlistEntry
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "WaitlistEntry";
CREATE POLICY studio_isolation ON "WaitlistEntry"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "ClassSession" s
      WHERE s.id = "WaitlistEntry"."sessionId"
        AND s."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- MembershipPlan + MembershipSubscription
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "MembershipPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipPlan" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "MembershipPlan";
CREATE POLICY studio_isolation ON "MembershipPlan"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

ALTER TABLE "MembershipSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipSubscription" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "MembershipSubscription";
CREATE POLICY studio_isolation ON "MembershipSubscription"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "MembershipPlan" p
      WHERE p.id = "MembershipSubscription"."planId"
        AND p."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- Product
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "Product";
CREATE POLICY studio_isolation ON "Product"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- PromoCode
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "PromoCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromoCode" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "PromoCode";
CREATE POLICY studio_isolation ON "PromoCode"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- InstructorAvailabilityBlock
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "InstructorAvailabilityBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstructorAvailabilityBlock" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "InstructorAvailabilityBlock";
CREATE POLICY studio_isolation ON "InstructorAvailabilityBlock"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- GuestPass
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "GuestPass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestPass" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "GuestPass";
CREATE POLICY studio_isolation ON "GuestPass"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- CreditTransaction (scoped via member → studio)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "CreditTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditTransaction" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "CreditTransaction";
CREATE POLICY studio_isolation ON "CreditTransaction"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m.id = "CreditTransaction"."memberId"
        AND m."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- PromoCodeRedemption (scoped via promoCode → studioId)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "PromoCodeRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromoCodeRedemption" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "PromoCodeRedemption";
CREATE POLICY studio_isolation ON "PromoCodeRedemption"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "PromoCode" pc
      WHERE pc.id = "PromoCodeRedemption"."promoCodeId"
        AND pc."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- MemberNote (scoped via member → studioId)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "MemberNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberNote" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "MemberNote";
CREATE POLICY studio_isolation ON "MemberNote"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR EXISTS (
      SELECT 1 FROM "Member" m
      WHERE m.id = "MemberNote"."memberId"
        AND m."studioId" = app.current_studio()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- InstructorPhoto (has studioId directly)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "InstructorPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstructorPhoto" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "InstructorPhoto";
CREATE POLICY studio_isolation ON "InstructorPhoto"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- BrandStudio (has studioId directly)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "BrandStudio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrandStudio" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "BrandStudio";
CREATE POLICY studio_isolation ON "BrandStudio"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- FranchiseStudio (has studioId directly)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "FranchiseStudio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FranchiseStudio" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "FranchiseStudio";
CREATE POLICY studio_isolation ON "FranchiseStudio"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- StudioNetworkMembership (has studioId directly)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "StudioNetworkMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudioNetworkMembership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "StudioNetworkMembership";
CREATE POLICY studio_isolation ON "StudioNetworkMembership"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- StudioNetwork — global cross-tenant entity (no studioId).
-- Enable RLS to satisfy the advisor; policy is always-open since
-- networks group studios together and must be visible to all.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "StudioNetwork" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudioNetwork" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "StudioNetwork";
CREATE POLICY studio_isolation ON "StudioNetwork"
  AS PERMISSIVE FOR ALL
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- Brand — global entity (no studioId, shared across franchises).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Brand" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "Brand";
CREATE POLICY studio_isolation ON "Brand"
  AS PERMISSIVE FOR ALL
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- Franchise — global entity (no studioId, belongs to a Brand).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Franchise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Franchise" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "Franchise";
CREATE POLICY studio_isolation ON "Franchise"
  AS PERMISSIVE FOR ALL
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- ProductSale (has studioId directly)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ProductSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSale" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "ProductSale";
CREATE POLICY studio_isolation ON "ProductSale"
  AS PERMISSIVE FOR ALL
  USING (
    app.current_studio() = '' OR "studioId" = app.current_studio()
  );

-- ─────────────────────────────────────────────────────────────
-- StripeEvent (global dedup table — no studioId)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "StripeEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StripeEvent" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_isolation ON "StripeEvent";
CREATE POLICY studio_isolation ON "StripeEvent"
  AS PERMISSIVE FOR ALL USING (true);

-- ── Verification query ───────────────────────────────────────
-- Run this after applying to confirm RLS is enabled:
--
-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'ClassSession','ClassTemplate','ClassSchedule',
--     'Member','Booking','WaitlistEntry',
--     'MembershipPlan','MembershipSubscription',
--     'Product','PromoCode','InstructorAvailabilityBlock',
--     'GuestPass','CreditTransaction',
--     'PromoCodeRedemption','MemberNote','InstructorPhoto',
--     'BrandStudio','FranchiseStudio','StudioNetworkMembership',
--     'StudioNetwork','Brand','Franchise'
--   )
-- ORDER BY tablename;
--
-- Test with context:
-- BEGIN;
--   SELECT set_config('app.current_studio_id', 'clxxx...', true);
--   SELECT count(*) FROM "ClassSession"; -- should return only that studio's rows
-- COMMIT;
