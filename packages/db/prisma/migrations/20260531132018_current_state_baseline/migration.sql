-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'LATE_CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "public"."SessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SportType" AS ENUM ('CYCLING', 'HIIT', 'YOGA', 'PILATES', 'BARRE', 'ROWING', 'RUNNING', 'STRENGTH', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."StationType" AS ENUM ('BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('PURCHASE', 'CLASS_DEBIT', 'REFUND', 'LATE_CANCEL_FEE', 'NO_SHOW_FEE', 'MANUAL_ADJUSTMENT', 'EXPIRY', 'MEMBERSHIP_RENEWAL', 'EXPIRY_PROCESSED');

-- CreateEnum
CREATE TYPE "public"."WaitlistEntryStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONFIRMED', 'EXPIRED', 'REMOVED');

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "meta" JSONB,
    "studioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Booking" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkedInAt" TIMESTAMP(3),
    "stationId" TEXT,
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'packd',
    "memberNote" TEXT,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrandStudio" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandStudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CancellationPolicy" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "lateCancelWindowHours" INTEGER NOT NULL DEFAULT 12,
    "lateCancelFeeCredits" INTEGER NOT NULL DEFAULT 1,
    "noShowFeeCredits" INTEGER NOT NULL DEFAULT 1,
    "waitlistWindowMinutes" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClassSchedule" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "creditsRequired" INTEGER NOT NULL DEFAULT 1,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ClassSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClassSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "public"."SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "creditsRequired" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "layoutId" TEXT,
    "scheduleId" TEXT,
    "substituteInstructorId" TEXT,
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'packd',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClassTemplate" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "sport" "public"."SportType" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "imageUrl" TEXT,
    "defaultCapacity" INTEGER,
    "defaultCreditsRequired" INTEGER,
    "defaultDaysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "defaultInstructorId" TEXT,
    "defaultIntervalWeeks" INTEGER NOT NULL DEFAULT 1,
    "defaultRoomId" TEXT,
    "defaultStartTime" TEXT,
    "defaultStartTime2" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClassTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditBalance" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditTransaction" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "public"."TransactionType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Franchise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Franchise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FranchiseStudio" (
    "id" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseStudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GuestPass" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "guestName" TEXT,
    "sessionId" TEXT,
    "note" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Instructor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "bio" TEXT,
    "photoUrl" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "payRatePerHeadCents" INTEGER,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstructorAvailabilityBlock" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorAvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstructorPhoto" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "approvedForSocial" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Location" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'packd',
    "staffRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "studioIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffPermissions" JSONB,
    "birthday" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "guestPassBalance" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "payRateHourlyCents" INTEGER,
    "emailPreferences" JSONB NOT NULL DEFAULT '{}',
    "lastWinbackAt" TIMESTAMP(3),
    "referralCode" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MemberNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MembershipPlan" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceInCents" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "creditsPerCycle" INTEGER,
    "stripePriceId" TEXT,
    "guestPassesPerCycle" INTEGER NOT NULL DEFAULT 0,
    "stripeProductId" TEXT,
    "creditExpiryDays" INTEGER,
    "isIntroOffer" BOOLEAN NOT NULL DEFAULT false,
    "maxRedemptionsPerMember" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MembershipSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "stripeSubId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "pausedUntil" TIMESTAMP(3),

    CONSTRAINT "MembershipSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceInCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "creditsRequired" INTEGER NOT NULL DEFAULT 0,
    "stripePriceId" TEXT,
    "stripeProductId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductSale" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "staffUserId" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    "refundedCents" INTEGER,
    "stripeRefundId" TEXT,
    "failedAt" TIMESTAMP(3),
    "stripeReceiptUrl" TEXT,

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PromoCode" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCouponId" TEXT,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PromoCodeRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Referral" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "rewardCredits" INTEGER NOT NULL DEFAULT 0,
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Room" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomLayout" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "widthM" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "lengthM" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StaffShift" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patternId" TEXT,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StaffShiftPattern" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StaffShiftPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Station" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "type" "public"."StationType" NOT NULL,
    "label" TEXT NOT NULL,
    "xM" DOUBLE PRECISION NOT NULL,
    "yM" DOUBLE PRECISION NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Studio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timeFormat" TEXT NOT NULL DEFAULT '24h',
    "bookingCloseHours" INTEGER NOT NULL DEFAULT 1,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 30,
    "creditPurchaseEnabled" BOOLEAN NOT NULL DEFAULT true,
    "guestCheckInEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supportEmail" TEXT,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "websiteUrl" TEXT,
    "classReminderHours" INTEGER DEFAULT 24,
    "maxPauseDays" INTEGER NOT NULL DEFAULT 30,
    "maxPausesPerYear" INTEGER NOT NULL DEFAULT 2,
    "selfCheckInEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "anthropicApiKey" TEXT,
    "allowMemberPause" BOOLEAN NOT NULL DEFAULT true,
    "referralRewardCredits" INTEGER NOT NULL DEFAULT 0,
    "stripeTaxRateId" TEXT,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudioIntegration" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudioNetwork" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudioNetworkMembership" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioNetworkMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaitlistEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "public"."WaitlistEntryStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "public"."AuditLog"("actorId" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_studioId_createdAt_idx" ON "public"."AuditLog"("studioId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "public"."AuditLog"("targetId" ASC);

-- CreateIndex
CREATE INDEX "Booking_bookedAt_idx" ON "public"."Booking"("bookedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_externalId_key" ON "public"."Booking"("externalId" ASC);

-- CreateIndex
CREATE INDEX "Booking_memberId_idx" ON "public"."Booking"("memberId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_sessionId_memberId_key" ON "public"."Booking"("sessionId" ASC, "memberId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_sessionId_stationId_key" ON "public"."Booking"("sessionId" ASC, "stationId" ASC);

-- CreateIndex
CREATE INDEX "Booking_sessionId_status_idx" ON "public"."Booking"("sessionId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "public"."Brand"("slug" ASC);

-- CreateIndex
CREATE INDEX "BrandStudio_brandId_idx" ON "public"."BrandStudio"("brandId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BrandStudio_brandId_studioId_key" ON "public"."BrandStudio"("brandId" ASC, "studioId" ASC);

-- CreateIndex
CREATE INDEX "BrandStudio_studioId_idx" ON "public"."BrandStudio"("studioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_studioId_key" ON "public"."CancellationPolicy"("studioId" ASC);

-- CreateIndex
CREATE INDEX "ClassSchedule_studioId_idx" ON "public"."ClassSchedule"("studioId" ASC);

-- CreateIndex
CREATE INDEX "ClassSession_scheduleId_idx" ON "public"."ClassSession"("scheduleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ClassSession_studioId_externalId_key" ON "public"."ClassSession"("studioId" ASC, "externalId" ASC);

-- CreateIndex
CREATE INDEX "ClassSession_studioId_startsAt_idx" ON "public"."ClassSession"("studioId" ASC, "startsAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreditBalance_memberId_key" ON "public"."CreditBalance"("memberId" ASC);

-- CreateIndex
CREATE INDEX "CreditTransaction_createdAt_idx" ON "public"."CreditTransaction"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "CreditTransaction_expiresAt_idx" ON "public"."CreditTransaction"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "CreditTransaction_memberId_idx" ON "public"."CreditTransaction"("memberId" ASC);

-- CreateIndex
CREATE INDEX "Franchise_brandId_idx" ON "public"."Franchise"("brandId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Franchise_slug_key" ON "public"."Franchise"("slug" ASC);

-- CreateIndex
CREATE INDEX "FranchiseStudio_franchiseId_idx" ON "public"."FranchiseStudio"("franchiseId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudio_franchiseId_studioId_key" ON "public"."FranchiseStudio"("franchiseId" ASC, "studioId" ASC);

-- CreateIndex
CREATE INDEX "FranchiseStudio_studioId_idx" ON "public"."FranchiseStudio"("studioId" ASC);

-- CreateIndex
CREATE INDEX "GuestPass_memberId_idx" ON "public"."GuestPass"("memberId" ASC);

-- CreateIndex
CREATE INDEX "GuestPass_studioId_idx" ON "public"."GuestPass"("studioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_userId_studioId_key" ON "public"."Instructor"("userId" ASC, "studioId" ASC);

-- CreateIndex
CREATE INDEX "InstructorAvailabilityBlock_instructorId_startDate_idx" ON "public"."InstructorAvailabilityBlock"("instructorId" ASC, "startDate" ASC);

-- CreateIndex
CREATE INDEX "InstructorAvailabilityBlock_studioId_startDate_idx" ON "public"."InstructorAvailabilityBlock"("studioId" ASC, "startDate" ASC);

-- CreateIndex
CREATE INDEX "InstructorPhoto_instructorId_idx" ON "public"."InstructorPhoto"("instructorId" ASC);

-- CreateIndex
CREATE INDEX "InstructorPhoto_studioId_idx" ON "public"."InstructorPhoto"("studioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Member_referralCode_key" ON "public"."Member"("referralCode" ASC);

-- CreateIndex
CREATE INDEX "Member_staffRoles_idx" ON "public"."Member" USING GIN ("staffRoles" array_ops ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Member_studioId_externalId_key" ON "public"."Member"("studioId" ASC, "externalId" ASC);

-- CreateIndex
CREATE INDEX "Member_studioId_idx" ON "public"."Member"("studioId" ASC);

-- CreateIndex
CREATE INDEX "Member_studioIds_idx" ON "public"."Member" USING GIN ("studioIds" array_ops ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "public"."Member"("userId" ASC);

-- CreateIndex
CREATE INDEX "MemberNote_memberId_idx" ON "public"."MemberNote"("memberId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipSubscription_externalId_key" ON "public"."MembershipSubscription"("externalId" ASC);

-- CreateIndex
CREATE INDEX "MembershipSubscription_memberId_idx" ON "public"."MembershipSubscription"("memberId" ASC);

-- CreateIndex
CREATE INDEX "MembershipSubscription_status_idx" ON "public"."MembershipSubscription"("status" ASC);

-- CreateIndex
CREATE INDEX "ProductSale_memberId_idx" ON "public"."ProductSale"("memberId" ASC);

-- CreateIndex
CREATE INDEX "ProductSale_studioId_soldAt_idx" ON "public"."ProductSale"("studioId" ASC, "soldAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_studioId_code_key" ON "public"."PromoCode"("studioId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "PromoCode_studioId_isActive_idx" ON "public"."PromoCode"("studioId" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_memberId_idx" ON "public"."PromoCodeRedemption"("memberId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_promoCodeId_memberId_key" ON "public"."PromoCodeRedemption"("promoCodeId" ASC, "memberId" ASC);

-- CreateIndex
CREATE INDEX "Referral_refereeId_idx" ON "public"."Referral"("refereeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referrerId_refereeId_key" ON "public"."Referral"("referrerId" ASC, "refereeId" ASC);

-- CreateIndex
CREATE INDEX "Referral_studioId_idx" ON "public"."Referral"("studioId" ASC);

-- CreateIndex
CREATE INDEX "StaffShift_memberId_startsAt_idx" ON "public"."StaffShift"("memberId" ASC, "startsAt" ASC);

-- CreateIndex
CREATE INDEX "StaffShift_patternId_idx" ON "public"."StaffShift"("patternId" ASC);

-- CreateIndex
CREATE INDEX "StaffShift_studioId_startsAt_idx" ON "public"."StaffShift"("studioId" ASC, "startsAt" ASC);

-- CreateIndex
CREATE INDEX "StaffShiftPattern_memberId_idx" ON "public"."StaffShiftPattern"("memberId" ASC);

-- CreateIndex
CREATE INDEX "StaffShiftPattern_studioId_memberId_idx" ON "public"."StaffShiftPattern"("studioId" ASC, "memberId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Studio_slug_key" ON "public"."Studio"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudioIntegration_studioId_key" ON "public"."StudioIntegration"("studioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudioNetwork_slug_key" ON "public"."StudioNetwork"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudioNetworkMembership_networkId_studioId_key" ON "public"."StudioNetworkMembership"("networkId" ASC, "studioId" ASC);

-- CreateIndex
CREATE INDEX "StudioNetworkMembership_studioId_idx" ON "public"."StudioNetworkMembership"("studioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_sessionId_memberId_key" ON "public"."WaitlistEntry"("sessionId" ASC, "memberId" ASC);

-- CreateIndex
CREATE INDEX "WaitlistEntry_sessionId_position_idx" ON "public"."WaitlistEntry"("sessionId" ASC, "position" ASC);

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrandStudio" ADD CONSTRAINT "BrandStudio_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrandStudio" ADD CONSTRAINT "BrandStudio_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CancellationPolicy" ADD CONSTRAINT "CancellationPolicy_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "public"."Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."ClassTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "public"."Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "public"."RoomLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."ClassSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_substituteInstructorId_fkey" FOREIGN KEY ("substituteInstructorId") REFERENCES "public"."Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassSession" ADD CONSTRAINT "ClassSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."ClassTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassTemplate" ADD CONSTRAINT "ClassTemplate_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditBalance" ADD CONSTRAINT "CreditBalance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditTransaction" ADD CONSTRAINT "CreditTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Franchise" ADD CONSTRAINT "Franchise_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FranchiseStudio" ADD CONSTRAINT "FranchiseStudio_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "public"."Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FranchiseStudio" ADD CONSTRAINT "FranchiseStudio_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GuestPass" ADD CONSTRAINT "GuestPass_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Instructor" ADD CONSTRAINT "Instructor_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstructorAvailabilityBlock" ADD CONSTRAINT "InstructorAvailabilityBlock_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "public"."Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstructorAvailabilityBlock" ADD CONSTRAINT "InstructorAvailabilityBlock_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstructorPhoto" ADD CONSTRAINT "InstructorPhoto_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "public"."Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Member" ADD CONSTRAINT "Member_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MemberNote" ADD CONSTRAINT "MemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MemberNote" ADD CONSTRAINT "MemberNote_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MembershipPlan" ADD CONSTRAINT "MembershipPlan_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductSale" ADD CONSTRAINT "ProductSale_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductSale" ADD CONSTRAINT "ProductSale_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PromoCode" ADD CONSTRAINT "PromoCode_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "public"."PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Referral" ADD CONSTRAINT "Referral_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomLayout" ADD CONSTRAINT "RoomLayout_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StaffShift" ADD CONSTRAINT "StaffShift_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StaffShift" ADD CONSTRAINT "StaffShift_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "public"."StaffShiftPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StaffShift" ADD CONSTRAINT "StaffShift_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StaffShiftPattern" ADD CONSTRAINT "StaffShiftPattern_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StaffShiftPattern" ADD CONSTRAINT "StaffShiftPattern_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Station" ADD CONSTRAINT "Station_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "public"."RoomLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudioIntegration" ADD CONSTRAINT "StudioIntegration_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudioNetworkMembership" ADD CONSTRAINT "StudioNetworkMembership_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "public"."StudioNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudioNetworkMembership" ADD CONSTRAINT "StudioNetworkMembership_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

