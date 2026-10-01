export const REVIEW_TAGS = [
  { id: 'PRODUCT_QUALITY', label: 'Product quality' },
  { id: 'COMMUNICATION', label: 'Communication/service' },
  { id: 'PACKAGING', label: 'Packaging' },
  { id: 'VALUE', label: 'Value for money' },
  { id: 'DELIVERY_PICKUP', label: 'Delivery/pickup' },
] as const;

export const REVIEW_TAG_IDS = REVIEW_TAGS.map((tag) => tag.id) as string[];

export function isReviewTag(value: unknown): value is (typeof REVIEW_TAGS)[number]['id'] {
  return typeof value === 'string' && REVIEW_TAG_IDS.includes(value);
}
