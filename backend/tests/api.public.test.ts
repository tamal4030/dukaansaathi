import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, seedBusiness, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(() => {
  ctx = buildTestApp();
});

describe('public browsing (acceptance 1)', () => {
  it('lists active public businesses without any authentication', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', name: 'Sharma Kirana' });
    seedBusiness(ctx.prisma, {
      id: 'biz-0002',
      name: 'Ritu Sarees',
      ownerAuthId: 'owner-2',
      category: 'FASHION_TEXTILES',
    });
    ctx.prisma.seed('business', [
      {
        id: 'biz-hidden',
        ownerId: 'profile-owner-1',
        name: 'Hidden Store',
        slug: 'hidden',
        category: 'FOOD_BEVERAGES',
        isActive: false,
        isPublic: false,
      },
    ]);

    const response = await request(ctx.app).get('/api/businesses').expect(200);
    const names = response.body.businesses.map((business: { name: string }) => business.name);
    expect(names).toContain('Sharma Kirana');
    expect(names).toContain('Ritu Sarees');
    expect(names).not.toContain('Hidden Store');
    expect(response.body.total).toBe(2);
  });

  it('filters by category and searches by name or city', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', name: 'Sharma Kirana' });
    seedBusiness(ctx.prisma, { id: 'biz-0002', name: 'Ritu Sarees', ownerAuthId: 'owner-2', category: 'FASHION_TEXTILES' });

    const byCategory = await request(ctx.app).get('/api/businesses?category=FASHION_TEXTILES').expect(200);
    expect(byCategory.body.businesses).toHaveLength(1);
    expect(byCategory.body.businesses[0].name).toBe('Ritu Sarees');

    const bySearch = await request(ctx.app).get('/api/businesses?search=sarees').expect(200);
    expect(bySearch.body.businesses).toHaveLength(1);
  });

  it('resolves the recently accessed list from stored ids only', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    const response = await request(ctx.app).get('/api/businesses/recent?ids=biz-0002,biz-0001,does-not-exist').expect(200);
    expect(response.body.businesses.map((business: { id: string }) => business.id)).toEqual(['biz-0002', 'biz-0001']);
  });

  it('never exposes private account data on a public business page', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    const response = await request(ctx.app).get('/api/businesses/biz-0001').expect(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('shop@example.com');
    expect(serialized).not.toContain('emailNotificationsEmail');
    expect(serialized).not.toContain('ownerId');
    expect(response.body.business.id).toBe('biz-0001');
  });

  it('reports open state as unknown when the business published no hours', async () => {
    ctx.prisma.seed('business', [
      { id: 'biz-nohours', ownerId: 'x', name: 'No Hours Store', slug: 'no-hours', category: 'FOOD_BEVERAGES', isActive: true, isPublic: true },
    ]);
    const response = await request(ctx.app).get('/api/businesses/biz-nohours').expect(200);
    expect(response.body.business.openState).toBe('unknown');
  });

  it('returns a clear 404 for an unknown business', async () => {
    const response = await request(ctx.app).get('/api/businesses/nope').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('serves the public product catalogue with search and availability intact', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    const all = await request(ctx.app).get('/api/businesses/biz-0001/products').expect(200);
    expect(all.body.products).toHaveLength(3);

    const milk = await request(ctx.app).get('/api/businesses/biz-0001/products?search=milk').expect(200);
    expect(milk.body.products).toHaveLength(1);
    expect(milk.body.products[0].availabilityLabel).toBe('Out of stock');

    const unknown = await request(ctx.app).get('/api/businesses/biz-0001/products?search=rice').expect(200);
    expect(unknown.body.products[0].availability).toBe('UNKNOWN');
    expect(unknown.body.products[0].availabilityLabel).not.toBe('Available');
  });

  it('exposes the seven business categories and review tags', async () => {
    const response = await request(ctx.app).get('/api/meta').expect(200);
    expect(response.body.categories).toHaveLength(7);
    expect(response.body.reviewTags.map((tag: { id: string }) => tag.id)).toContain('PRODUCT_QUALITY');
    expect(response.body.availability.map((entry: { id: string }) => entry.id)).toEqual([
      'AVAILABLE',
      'OUT_OF_STOCK',
      'UNKNOWN',
    ]);
  });

  it('reports which integrations are configured instead of pretending they work', async () => {
    const response = await request(ctx.app).get('/api/health/features').expect(200);
    expect(response.body).toHaveProperty('assistant');
    expect(response.body).toHaveProperty('email');
  });
});
