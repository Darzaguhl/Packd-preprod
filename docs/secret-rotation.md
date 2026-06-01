# Secret Rotation Runbook

How to rotate each secret without downtime or user disruption.

---

## ICAL_SECRET (iCal feed tokens)

iCal tokens are stable HMACs embedded in URLs bookmarked by calendar apps (Google Calendar, Apple Calendar, etc.). A naive rotation invalidates all existing subscriptions immediately — users see "calendar not found" until they re-subscribe.

**Zero-downtime rotation procedure:**

```
Step 1 — Generate a new secret
  openssl rand -hex 32   # copy this output as NEW_SECRET

Step 2 — Deploy with both keys
  ICAL_SECRET=<NEW_SECRET>
  ICAL_SECRET_PREVIOUS=<OLD_SECRET>

  The API now: signs new tokens with NEW_SECRET,
               accepts tokens signed with EITHER key.

Step 3 — Wait ~30 days
  Calendar apps typically poll their subscriptions daily.
  After 30 days, all active subscriptions have been validated
  against the new key at least once (they don't re-fetch the
  token URL, but the token in the URL they already saved is
  still accepted via ICAL_SECRET_PREVIOUS).

  Actually: the token in the URL never changes — it was signed
  with the old key and remains in the user's calendar app URL.
  So ICAL_SECRET_PREVIOUS must stay set until users manually
  re-fetch their token from GET /ical/token and update their
  subscription URL.

  Pragmatic approach: send an in-app notification asking users
  to refresh their iCal subscription, then drop PREVIOUS after
  the notification has been live for 30 days.

Step 4 — Drop the old key
  ICAL_SECRET=<NEW_SECRET>
  # remove ICAL_SECRET_PREVIOUS

  Any remaining old-token subscriptions will now return 404
  until the user re-subscribes.
```

**Why the token stays in the URL:** the token is a stable HMAC of the user ID. Calendar apps store the full URL (`/ical/instructor/:userId/:token`) and poll it repeatedly. The token in that URL was generated when the user first clicked "Subscribe". To get a new token signed with the new secret, the user must visit their account page and click "Subscribe" again.

---

## INVITE_SECRET (staff invite tokens)

Staff invite tokens have a built-in 7-day expiry. No grace period needed.

```
Step 1 — Generate a new secret
  openssl rand -hex 32

Step 2 — Deploy with new secret
  INVITE_SECRET=<NEW_SECRET>
  # Old INVITE_SECRET removed

Step 3 — Done
  Any pending invite links signed with the old secret will fail
  verification and show "Invalid or expired invite link". This is
  acceptable — staff who received an invite link in the past 7 days
  will need a new one. For invites older than 7 days, they were
  already expired regardless of rotation.
```

---

## Stripe keys

Stripe key rotation must be coordinated with Stripe's dashboard.

```
Step 1 — Create a new restricted key in Stripe Dashboard
         (Settings → API keys → Create restricted key)

Step 2 — Add new key to your environment alongside the old:
         STRIPE_SECRET_KEY=<NEW_KEY>

Step 3 — Deploy. New API calls use the new key.
         The old key is still active in Stripe.

Step 4 — Verify webhook deliveries are working with the new key.

Step 5 — Revoke the old key in Stripe Dashboard.
```

For `STRIPE_WEBHOOK_SECRET`: this is tied to a specific webhook endpoint in Stripe. To rotate:
1. Add a second webhook endpoint in Stripe (same URL, new endpoint) — this gives a new signing secret.
2. Set `STRIPE_WEBHOOK_SECRET=<new_secret>` and deploy.
3. Delete the old webhook endpoint in Stripe.

---

## SUPABASE_SERVICE_ROLE_KEY

The service role key is used for admin-level Supabase Auth operations (create user, set app_metadata, revoke sessions).

```
Step 1 — Generate a new service role key in Supabase
         Project Settings → API → Regenerate service_role key

Step 2 — Update SUPABASE_SERVICE_ROLE_KEY in your deployment environment

Step 3 — Deploy immediately (old key is invalidated when you regenerate)
         This is a hard cutover — minimize time between steps 2 and 3.

Step 4 — Verify: POST /staff/invite should succeed (it uses the service key)
```

**Note:** Supabase regenerates the key in-place — there is no period where both old and new are valid. Plan for a brief deployment window where auth admin operations may fail (~1-2 minutes).

---

## Rotation schedule recommendations

| Secret | Recommended interval | Notes |
|---|---|---|
| `ICAL_SECRET` | Annually or on compromise | Coordinate with user notification |
| `INVITE_SECRET` | Quarterly | 7-day token expiry makes this low-risk |
| `STRIPE_SECRET_KEY` | On staff offboarding, or annually | Use restricted keys with minimal permissions |
| `STRIPE_WEBHOOK_SECRET` | On staff offboarding | Tied to endpoint; easy to rotate |
| `SUPABASE_SERVICE_ROLE_KEY` | On staff offboarding | Hard cutover; plan deploy window |
| `RESEND_API_KEY` | Annually | Low risk — email only, not auth |

---

## Detecting a compromised secret

Signs a secret may be compromised:
- Unexpected iCal subscription activity from unknown IPs
- Staff invite tokens being accepted that were never sent
- Unexpected Stripe charges or refunds via the API
- Supabase Auth admin operations you didn't initiate (check Supabase logs)

If compromise is suspected: rotate immediately, skip the grace period, accept that some users will need to re-subscribe/re-authenticate.
