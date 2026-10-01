import { describe, expect, it } from 'vitest';
import { rankProducts, scoreProduct, tokenize } from '../src/services/search';

const products = [
  { name: 'Aashirvaad Atta 5kg', category: 'Atta & rice', description: null, aliases: ['atta', 'aata', 'wheat flour'] },
  { name: 'Miniket Rice 5kg', category: 'Atta & rice', description: null, aliases: ['rice', 'chal'] },
  { name: 'Amul Taaza Milk 500ml', category: 'Dairy', description: null, aliases: ['milk', 'dudh'] },
];

describe('product search', () => {
  it('drops stopwords and keeps useful tokens', () => {
    expect(tokenize('do you have atta?')).toEqual(['atta']);
    expect(tokenize('a')).toEqual([]);
  });

  it('matches on the product name', () => {
    const scored = scoreProduct(products[0], tokenize('aashirvaad atta'));
    expect(scored).toBeGreaterThan(0);
  });

  it('matches on alternate names used by customers', () => {
    const scored = scoreProduct(products[1], tokenize('chal'));
    expect(scored).toBeGreaterThan(0);
    expect(scoreProduct(products[2], tokenize('chal'))).toBe(0);
  });

  it('ranks the best match first and excludes unrelated products', () => {
    const ranked = rankProducts(products, 'dudh', 5);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].product.name).toContain('Milk');
  });

  it('returns no match for something the shop does not sell', () => {
    expect(rankProducts(products, 'washing machine', 5)).toHaveLength(0);
  });
});
