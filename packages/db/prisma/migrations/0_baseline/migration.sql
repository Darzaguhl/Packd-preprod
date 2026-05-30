-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER');

-- CreateEnum
CREATE TYPE "SportType" AS ENUM ('CYCLING', 'HIIT', 'YOGA', 'PILATES', 'BARRE', 'ROWING', 'RUNNING', 'STRENGTH', 'OTHER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'LATE_CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WaitlistEntryStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONFIRMED', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PURCHASE', 'CLASS_DEBIT', 'REFUND', 'LATE_CANCEL_FEE', 'NO_SHOW_FEE', 'MANUAL_ADJUSTMENT', 'MEMBERSHIP_RENEWAL', 'EXPIRY', 'EXPIRY_PROCESSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateTable
CREATE TABLE "Studio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timeFormat" TEXT NOT NULL DEFAULT '24h',
    "websiteUrl" TEXT,
    "supportEmail" TEXT,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 30,
    "bookingCloseHours" INTEGER NOT NULL DEFAULT 1,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "guestCheckInEnabled" BOOLEAN NOT NULL DEFAULT true,
    "creditPurchaseEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selfCheckInEnabled" BOOLEAN NOT NULL DEFAULT false,
    "classReminderHours" INTEGER DEFAULT 24,
    "maxPauseDays" INTEGER NOT NULL DEFAULT 30,
    "maxPausesPerYear" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
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
CREATE TABLE "BrandStudio" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandStudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Franchise" (
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
CREATE TABLE "FranchiseStudio" (
    "id" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseStudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioNetwork" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioNetworkMembership" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioNetworkMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioIntegration" (
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
CREATE TABLE "User" (
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
CREATE TABLE "Location" (
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
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomLayout" (
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
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "type" "StationType" NOT NULL,
    "label" TEXT NOT NULL,
    "xM" DOUBLE PRECISION NOT NULL,
    "yM" DOUBLE PRECISION NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instructor" (
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
CREATE TABLE "InstructorPhoto" (
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
CREATE TABLE "ClassTemplate" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "sport" "SportType" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "imageUrl" TEXT,
    "defaultInstructorId" TEXT,
    "defaultRoomId" TEXT,
    "defaultCapacity" INTEGER,
    "defaultCreditsRequired" INTEGER,
    "defaultStartTime" TEXT,
    "defaultStartTime2" TEXT,
    "defaultDaysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "defaultIntervalWeeks" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ClassTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSchedule" (
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
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "layoutId" TEXT,
    "scheduleId" TEXT,
    "substituteInstructorId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "creditsRequired" INTEGER NOT NULL DEFAULT 1,
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'packd',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
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

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "stationId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkedInAt" TIMESTAMP(3),
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'packd',

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "WaitlistEntryStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBalance" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceInCents" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "creditsPerCycle" INTEGER,
    "guestPassesPerCycle" INTEGER NOT NULL DEFAULT 0,
    "creditExpiryDays" INTEGER,
    "isIntroOffer" BOOLEAN NOT NULL DEFAULT false,
    "maxRedemptionsPerMember" INTEGER NOT NULL DEFAULT 1,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "pausedUntil" TIMESTAMP(3),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "stripeSubId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicy" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "lateCancelWindowHours" INTEGER NOT NULL DEFAULT 12,
    "lateCancelFeeCredits" INTEGER NOT NULL DEFAULT 1,
    "noShowFeeCredits" INTEGER NOT NULL DEFAULT 1,
    "waitlistWindowMinutes" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "priceInCents" INTEGER NOT NULL,
    "creditsRequired" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSale" (
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

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
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
CREATE TABLE "MemberNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorAvailabilityBlock" (
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
CREATE TABLE "PromoCode" (
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
CREATE TABLE "PromoCodeRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestPass" (
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

-- CreateIndex
CREATE UNIQUE INDEX "Studio_slug_key" ON "Studio"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "BrandStudio_brandId_idx" ON "BrandStudio"("brandId");

-- CreateIndex
CREATE INDEX "BrandStudio_studioId_idx" ON "BrandStudio"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandStudio_brandId_studioId_key" ON "BrandStudio"("brandId", "studioId");

-- CreateIndex
CREATE UNIQUE INDEX "Franchise_slug_key" ON "Franchise"("slug");

-- CreateIndex
CREATE INDEX "Franchise_brandId_idx" ON "Franchise"("brandId");

-- CreateIndex
CREATE INDEX "FranchiseStudio_franchiseId_idx" ON "FranchiseStudio"("franchiseId");

-- CreateIndex
CREATE INDEX "FranchiseStudio_studioId_idx" ON "FranchiseStudio"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudio_franchiseId_studioId_key" ON "FranchiseStudio"("franchiseId", "studioId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioNetwork_slug_key" ON "StudioNetwork"("slug");

-- CreateIndex
CREATE INDEX "StudioNetworkMembership_studioId_idx" ON "StudioNetworkMembership"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioNetworkMembership_networkId_studioId_key" ON "StudioNetworkMembership"("networkId", "studioId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioIntegration_studioId_key" ON "StudioIntegration"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_userId_studioId_key" ON "Instructor"("userId", "studioId");

-- CreateIndex
CREATE INDEX "InstructorPhoto_instructorId_idx" ON "InstructorPhoto"("instructorId");

-- CreateIndex
CREATE INDEX "InstructorPhoto_studioId_idx" ON "InstructorPhoto"("studioId");

-- CreateIndex
CREATE INDEX "ClassSchedule_studioId_idx" ON "ClassSchedule"("studioId");

-- CreateIndex
CREATE INDEX "ClassSession_studioId_startsAt_idx" ON "ClassSession"("studioId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_scheduleId_idx" ON "ClassSession"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSession_studioId_externalId_key" ON "ClassSession"("studioId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_studioId_idx" ON "Member"("studioId");

-- CreateIndex
CREATE INDEX "Member_staffRoles_idx" ON "Member" USING GIN ("staffRoles");

-- CreateIndex
CREATE INDEX "Member_studioIds_idx" ON "Member" USING GIN ("studioIds");

-- CreateIndex
CREATE UNIQUE INDEX "Member_studioId_externalId_key" ON "Member"("studioId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_externalId_key" ON "Booking"("externalId");

-- CreateIndex
CREATE INDEX "Booking_memberId_idx" ON "Booking"("memberId");

-- CreateIndex
CREATE INDEX "Booking_sessionId_status_idx" ON "Booking"("sessionId", "status");

-- CreateIndex
CREATE INDEX "Booking_bookedAt_idx" ON "Booking"("bookedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_sessionId_memberId_key" ON "Booking"("sessionId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_sessionId_stationId_key" ON "Booking"("sessionId", "stationId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_sessionId_position_idx" ON "WaitlistEntry"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_sessionId_memberId_key" ON "WaitlistEntry"("sessionId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditBalance_memberId_key" ON "CreditBalance"("memberId");

-- CreateIndex
CREATE INDEX "CreditTransaction_memberId_idx" ON "CreditTransaction"("memberId");

-- CreateIndex
CREATE INDEX "CreditTransaction_expiresAt_idx" ON "CreditTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_createdAt_idx" ON "CreditTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipSubscription_externalId_key" ON "MembershipSubscription"("externalId");

-- CreateIndex
CREATE INDEX "MembershipSubscription_memberId_idx" ON "MembershipSubscription"("memberId");

-- CreateIndex
CREATE INDEX "MembershipSubscription_status_idx" ON "MembershipSubscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_studioId_key" ON "CancellationPolicy"("studioId");

-- CreateIndex
CREATE INDEX "ProductSale_memberId_idx" ON "ProductSale"("memberId");

-- CreateIndex
CREATE INDEX "ProductSale_studioId_soldAt_idx" ON "ProductSale"("studioId", "soldAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_studioId_createdAt_idx" ON "AuditLog"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "MemberNote_memberId_idx" ON "MemberNote"("memberId");

-- CreateIndex
CREATE INDEX "InstructorAvailabilityBlock_instructorId_startDate_idx" ON "InstructorAvailabilityBlock"("instructorId", "startDate");

-- CreateIndex
CREATE INDEX "InstructorAvailabilityBlock_studioId_startDate_idx" ON "InstructorAvailabilityBlock"("studioId", "startDate");

-- CreateIndex
CREATE INDEX "PromoCode_studioId_isActive_idx" ON "PromoCode"("studioId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_studioId_code_key" ON "PromoCode"("studioId", "code");

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_memberId_idx" ON "PromoCodeRedemption"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_promoCodeId_memberId_key" ON "PromoCodeRedemption"("promoCodeId", "memberId");

-- CreateIndex
CREATE INDEX "GuestPass_memberId_idx" ON "GuestPass"("memberId");

-- CreateIndex
CREATE INDEX "GuestPass_studioId_idx" ON "GuestPass"("studioId");

-- AddForeignKey
ALTER TABLE "BrandStudio" ADD CONSTRAINT "BrandStudio_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStudio" ADD CONSTRAINT "BrandStudio_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Franchise" ADD CONSTRAINT "Franchise_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudio" ADD CONSTRAINT "FranchiseStudio_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudio" ADD CONSTRAINT "FranchiseStudio_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioNetworkMembership" ADD CONSTRAINT "StudioNetworkMembership_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "StudioNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioNetworkMembership" ADD CONSTRAINT "StudioNetworkMembership_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioIntegration" ADD CONSTRAINT "StudioIntegration_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomLayout" ADD CONSTRAINT "RoomLayout_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "RoomLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorPhoto" ADD CONSTRAINT "InstructorPhoto_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTemplate" ADD CONSTRAINT "ClassTemplate_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSchedule" ADD CONSTRAINT "ClassSchedule_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSchedule" ADD CONSTRAINT "ClassSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClassTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSchedule" ADD CONSTRAINT "ClassSchedule_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSchedule" ADD CONSTRAINT "ClassSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClassTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "RoomLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ClassSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_substituteInstructorId_fkey" FOREIGN KEY ("substituteInstructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBalance" ADD CONSTRAINT "CreditBalance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationPolicy" ADD CONSTRAINT "CancellationPolicy_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAvailabilityBlock" ADD CONSTRAINT "InstructorAvailabilityBlock_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAvailabilityBlock" ADD CONSTRAINT "InstructorAvailabilityBlock_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPass" ADD CONSTRAINT "GuestPass_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

