import type { Product } from '@prisma/client';
import type { Db } from '../db/prisma';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'do', 'you', 'have', 'has', 'of', 'for', 'me', 'my', 'i',
  'kya', 'hai', 'hain', 'ki', 'ka', 'ke', 'koi', 'aap', 'apna',
  'ki', 'kothay', 'ache', 'achhe', 'na', 'ami', 'amar', 'ekta',
]);

export function tokenize(query: string): string[] {
  return String(query ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .slice(0, 12);
}

export type ScorableProduct = Pick<Product, 'name' | 'category' | 'description' | 'aliases'>;

/**
 * Ordinary keyword matching with alias support - deliberately no vector store
 * in the MVP. Returns 0 when a product is unrelated to the query.
 */
export function scoreProduct(product: ScorableProduct, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = (product.name || '').toLowerCase();
  const category = (product.category || '').toLowerCase();
  const description = (product.description || '').toLowerCase();
  const aliases = (product.aliases || []).map((alias) => alias.toLowerCase());

  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 6;
    else if (new RegExp(`\\b${escapeRegExp(token)}\\b`, 'u').test(name)) score += 4;
    else if (name.includes(token)) score += 2.5;

    if (aliases.some((alias) => alias === token)) score += 4;
    else if (aliases.some((alias) => alias.includes(token))) score += 2;

    if (category.includes(token)) score += 1.5;
    if (description.includes(token)) score += 0.75;
  }
  return score;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rankProducts<T extends ScorableProduct>(
  products: T[],
  query: string,
  limit: number,
): Array<{ product: T; score: number }> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return products.slice(0, limit).map((product) => ({ product, score: 0 }));
  return products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, limit);
}

const CANDIDATE_LIMIT = 400;

/**
 * Pulls only products that can plausibly match, so a big catalog is never sent
 * to the model. Matching happens in the database first, then in memory.
 */
export async function findRelevantProducts(
  prisma: Db,
  businessId: string,
  query: string,
  limit = 12,
): Promise<Array<{ product: Product; score: number }>> {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    const products = await prisma.product.findMany({
      where: { businessId, isArchived: false },
      orderBy: { name: 'asc' },
      take: Math.min(limit, 20),
    });
    return products.map((product) => ({ product, score: 0 }));
  }

  const candidates = await prisma.product.findMany({
    where: {
      businessId,
      isArchived: false,
      OR: tokens.flatMap((token) => [
        { name: { contains: token, mode: 'insensitive' as const } },
        { category: { contains: token, mode: 'insensitive' as const } },
        { description: { contains: token, mode: 'insensitive' as const } },
        { aliases: { has: token } },
      ]),
    },
    orderBy: { name: 'asc' },
    take: CANDIDATE_LIMIT,
  });

  return rankProducts(candidates, query, limit);
}
