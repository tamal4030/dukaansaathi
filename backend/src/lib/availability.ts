import { Availability } from '@prisma/client';

export const AVAILABILITY_VALUES: Availability[] = ['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN'];

/**
 * Spreadsheet friendly synonyms. Anything unrecognised is an error so an
 * import can never silently downgrade a real value to UNKNOWN or AVAILABLE.
 */
const SYNONYMS: Record<string, Availability> = {
  available: 'AVAILABLE',
  'in stock': 'AVAILABLE',
  'in-stock': 'AVAILABLE',
  instock: 'AVAILABLE',
  yes: 'AVAILABLE',
  y: 'AVAILABLE',
  true: 'AVAILABLE',
  'out of stock': 'OUT_OF_STOCK',
  'out-of-stock': 'OUT_OF_STOCK',
  outofstock: 'OUT_OF_STOCK',
  'out of stock ': 'OUT_OF_STOCK',
  oos: 'OUT_OF_STOCK',
  no: 'OUT_OF_STOCK',
  n: 'OUT_OF_STOCK',
  false: 'OUT_OF_STOCK',
  unavailable: 'OUT_OF_STOCK',
  'not available': 'OUT_OF_STOCK',
  soldout: 'OUT_OF_STOCK',
  'sold out': 'OUT_OF_STOCK',
  unknown: 'UNKNOWN',
  'availability unknown': 'UNKNOWN',
  'not sure': 'UNKNOWN',
  unsure: 'UNKNOWN',
  'n/a': 'UNKNOWN',
  na: 'UNKNOWN',
  '-': 'UNKNOWN',
  '': 'UNKNOWN',
};

export type AvailabilityParseResult =
  | { ok: true; value: Availability }
  | { ok: false; error: string };

/** Normalises a raw spreadsheet/cell value into one of the three states. */
export function parseAvailability(raw: unknown): AvailabilityParseResult {
  if (raw === null || raw === undefined) return { ok: true, value: 'UNKNOWN' };
  const text = String(raw).trim();
  if (text === '') return { ok: true, value: 'UNKNOWN' };

  const upper = text.toUpperCase().replace(/\s+/g, ' ').trim();
  if (AVAILABILITY_VALUES.includes(upper as Availability)) {
    return { ok: true, value: upper as Availability };
  }
  const synonym = SYNONYMS[text.toLowerCase().replace(/\s+/g, ' ')];
  if (synonym) return { ok: true, value: synonym };

  return {
    ok: false,
    error: `Availability "${text}" is not recognised. Use Available, Out of stock or Unknown.`,
  };
}

/**
 * API/UI helper: never infers Available from Unknown.
 * The wording here is also accepted by parseAvailability so an exported file
 * can be re-imported unchanged (see tests/api.products.test.ts).
 */
export function availabilityLabel(value: Availability): string {
  switch (value) {
    case 'AVAILABLE':
      return 'Available';
    case 'OUT_OF_STOCK':
      return 'Out of stock';
    default:
      return 'Availability unknown';
  }
}

export function isOrderable(value: Availability): boolean {
  return value === 'AVAILABLE';
}
