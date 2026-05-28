/**
 * stripe-sync.ts
 *
 * Keeps Stripe products and prices in sync with Packd data.
 * Packd is always the source of truth — Stripe is the payment rail.
 *
 * Key facts about Stripe:
 *  - Products: mutable (name/description can be updated)
 *  - Prices: IMMUTABLE — amount/currency/interval cannot be changed.
 *    To change a price: create a new one, archive the old one.
 */

import Stripe from 'stripe'

// Lazy-init so tests without STRIPE_SECRET_KEY don't blow up at import time
let _stripe: Stripe | null = null
function stripe(): Stripe { return _stripe ?? (_stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)) }

export type StripeSyncResult = {
  stripeProductId: string
  stripePriceId: string
}

interface SyncPriceOptions {
  /** Existing Stripe product ID (if already created) */
  stripeProductId?: string | null
  /** Existing Stripe price ID (if already created) */
  stripePriceId?: string | null
  /** Display name for the product in Stripe */
  name: string
  description?: string | null
  /** Price in smallest currency unit (cents, øre, etc.) */
  priceInCents: number
  /** ISO 4217 currency code, e.g. "nok", "usd" */
  currency: string
  /** For memberships: billing interval. Omit for one-time payments. */
  recurring?: { interval: 'month'; interval_count: number }
}

/**
 * Ensure a Stripe Product + Price exist and match the given options.
 * - Creates the product if it doesn't exist yet.
 * - Creates a new price if the amount/currency/interval changed; archives the old one.
 * - Returns the current { stripeProductId, stripePriceId } to persist in the DB.
 */
export async function syncStripePrice(opts: SyncPriceOptions): Promise<StripeSyncResult> {
  const currency = opts.currency.toLowerCase()

  // ── 1. Ensure product exists ──────────────────────────────────────────────
  let productId: string
  if (opts.stripeProductId) {
    // Update name/description in case they changed
    await stripe().products.update(opts.stripeProductId, {
      name: opts.name,
      ...(opts.description != null && { description: opts.description }),
    })
    productId = opts.stripeProductId
  } else {
    const product = await stripe().products.create({
      name: opts.name,
      ...(opts.description != null && { description: opts.description }),
    })
    productId = product.id
  }

  // ── 2. Check if existing price still matches ──────────────────────────────
  if (opts.stripePriceId) {
    const existing = await stripe().prices.retrieve(opts.stripePriceId)
    const sameAmount = existing.unit_amount === opts.priceInCents
    const sameCurrency = existing.currency === currency
    const sameRecurring =
      opts.recurring
        ? existing.recurring?.interval === opts.recurring.interval &&
          existing.recurring?.interval_count === opts.recurring.interval_count
        : existing.recurring == null

    if (sameAmount && sameCurrency && sameRecurring && existing.active) {
      // Nothing changed — keep using the same price
      return { stripeProductId: productId, stripePriceId: opts.stripePriceId }
    }

    // Price changed — archive the old one
    await stripe().prices.update(opts.stripePriceId, { active: false })
  }

  // ── 3. Create new price ───────────────────────────────────────────────────
  const newPrice = await stripe().prices.create({
    product: productId,
    unit_amount: opts.priceInCents,
    currency,
    ...(opts.recurring && { recurring: opts.recurring }),
  })

  return { stripeProductId: productId, stripePriceId: newPrice.id }
}

/**
 * Archive a Stripe product and its active prices when an item is deleted in Packd.
 */
export async function archiveStripeProduct(stripeProductId: string): Promise<void> {
  // Archive all active prices first (Stripe requires this before archiving the product)
  const prices = await stripe().prices.list({ product: stripeProductId, active: true })
  await Promise.all(prices.data.map(p => stripe().prices.update(p.id, { active: false })))
  await stripe().products.update(stripeProductId, { active: false })
}
