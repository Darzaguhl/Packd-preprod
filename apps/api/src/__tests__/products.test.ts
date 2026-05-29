import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const product = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  return { prisma: { product } }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'admin@packd.test', role: 'studio_admin' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { productRoutes } from '../routes/products.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(productRoutes, { prefix: '/products' })
  return app
}

const mockProduct = (overrides = {}) => ({
  id: 'product-1',
  studioId: 'studio-1',
  name: 'Protein Shake',
  category: 'Drinks',
  priceInCents: 500,
  creditsRequired: 0,
  imageUrl: null,
  inStock: true,
  ...overrides,
})

describe('GET /products', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns in-stock products for a studio', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct()] as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/products?studioId=studio-1' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
    expect(vi.mocked(prisma.product.findMany).mock.calls[0][0]).toMatchObject({
      where: { studioId: 'studio-1', inStock: true },
    })
  })

  it('includes out-of-stock products when all=true', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct(), mockProduct({ id: 'product-2', inStock: false })] as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/products?studioId=studio-1&all=true' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(2)
    // Should NOT filter by inStock when all=true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((vi.mocked(prisma.product.findMany).mock.calls[0][0] as any).where).not.toHaveProperty('inStock')
  })

  it('returns 400 when studioId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/products' })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /products', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a product and returns 201', async () => {
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      body: { studioId: 'studio-1', name: 'Protein Shake', priceInCents: 500 },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ name: 'Protein Shake' })
  })

  it('defaults creditsRequired to 0', async () => {
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never)
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/products',
      body: { studioId: 'studio-1', name: 'Water', priceInCents: 0 },
    })
    const createArg = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createArg.data.creditsRequired).toBe(0)
  })

  it('returns 400 when required fields are missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      body: { name: 'No Studio' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /products/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates a product', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct() as never)
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ inStock: false }) as never)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/products/product-1',
      body: { inStock: false },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ inStock: false })
  })

  it('returns 404 when product does not exist', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/products/nonexistent',
      body: { name: 'Updated' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /products/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes a product and returns success', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct() as never)
    vi.mocked(prisma.product.delete).mockResolvedValue(mockProduct() as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/products/product-1' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true })
  })

  it('returns 404 when product does not exist', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/products/nonexistent' })
    expect(res.statusCode).toBe(404)
  })
})
