-- Add nextBillingDate to MembershipSubscription for caching Stripe billing cycle
-- Eliminates synchronous Stripe API call on GET /members/me
ALTER TABLE "MembershipSubscription" ADD COLUMN "nextBillingDate" TIMESTAMP(3);
