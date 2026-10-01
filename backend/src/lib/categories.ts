export const BUSINESS_CATEGORIES = [
  { id: 'GROCERY_DAILY_ESSENTIALS', slug: 'grocery-daily-essentials', label: 'Grocery & daily essentials' },
  { id: 'FOOD_BEVERAGES', slug: 'food-beverages', label: 'Food & beverages' },
  { id: 'FASHION_TEXTILES', slug: 'fashion-textiles', label: 'Fashion & textiles' },
  { id: 'ELECTRONICS_APPLIANCES', slug: 'electronics-appliances', label: 'Electronics & appliances' },
  { id: 'HEALTH_PERSONAL_CARE', slug: 'health-personal-care', label: 'Health & personal care' },
  { id: 'HOME_HARDWARE', slug: 'home-hardware', label: 'Home & hardware' },
  { id: 'BOOKS_STATIONERY_GIFTS_OTHER', slug: 'books-stationery-gifts-other', label: 'Books, stationery, gifts & other/mixed retail' },
] as const;

export type BusinessCategoryId = (typeof BUSINESS_CATEGORIES)[number]['id'];

export const BUSINESS_CATEGORY_IDS = BUSINESS_CATEGORIES.map((category) => category.id) as string[];

export function isBusinessCategory(value: unknown): value is BusinessCategoryId {
  return typeof value === 'string' && BUSINESS_CATEGORY_IDS.includes(value);
}

export function categoryLabel(id: string): string {
  return BUSINESS_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
