import { parseAvailability } from '../../lib/availability';
import { Availability } from '@prisma/client';

export const TEMPLATE_SHEET = 'Products';
export const INSTRUCTIONS_SHEET = 'How to use this template';

/** Canonical template columns, in order. */
export const PRODUCT_COLUMNS = {
  name: 'Name',
  price: 'Price',
  availability: 'Availability',
  description: 'Description',
  category: 'Category',
  aliases: 'Alternate names',
} as const;

export const REQUIRED_COLUMNS: Array<keyof typeof PRODUCT_COLUMNS> = ['name', 'price', 'availability'];

const HEADER_ALIASES: Record<string, keyof typeof PRODUCT_COLUMNS> = {
  name: 'name',
  'product name': 'name',
  item: 'name',
  'item name': 'name',
  product: 'name',
  price: 'price',
  'price (inr)': 'price',
  'price inr': 'price',
  mrp: 'price',
  rate: 'price',
  amount: 'price',
  availability: 'availability',
  stock: 'availability',
  'stock status': 'availability',
  'in stock': 'availability',
  status: 'availability',
  description: 'description',
  details: 'description',
  category: 'category',
  'product category': 'category',
  aliases: 'aliases',
  alias: 'aliases',
  'alternate names': 'aliases',
  'alternate name': 'aliases',
  'other names': 'aliases',
  keywords: 'aliases',
};

export function canonicalHeader(raw: string): keyof typeof PRODUCT_COLUMNS | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return HEADER_ALIASES[key] ?? null;
}

export interface ImportRow {
  name: string;
  price: string;
  availability: Availability;
  description: string | null;
  category: string | null;
  aliases: string[];
}

export interface ImportIssue {
  row: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedProductImport {
  rows: ImportRow[];
  issues: ImportIssue[];
  headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>>;
  missingColumns: string[];
  totalRows: number;
}

const MAX_ROWS = 2000;
const MAX_NAME = 140;
const MAX_PRICE = 1_000_000;
const MAX_ALIASES = 12;

export function parsePrice(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, error: 'Price is required.' };
  }
  const cleaned = String(raw)
    .replace(/[\u20b9$,\s]/g, '')
    .replace(/^rs\.?/i, '')
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: `Price "${String(raw).trim()}" is not a valid amount. Use numbers like 249 or 249.50.` };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE) {
    return { ok: false, error: `Price must be between 0 and ${MAX_PRICE}.` };
  }
  return { ok: true, value: value.toFixed(2) };
}

export function parseAliases(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(/[,;|\n]/)
    .map((alias) => alias.trim())
    .filter(Boolean)
    .slice(0, MAX_ALIASES)
    .map((alias) => alias.slice(0, 80));
}

function text(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'object' && raw !== null && 'text' in (raw as Record<string, unknown>)) {
    return String((raw as { text: unknown }).text ?? '').trim();
  }
  if (typeof raw === 'object' && raw !== null && 'result' in (raw as Record<string, unknown>)) {
    return String((raw as { result: unknown }).result ?? '').trim();
  }
  return String(raw).trim();
}

export const cellToText = text;

export function validateRow(
  raw: Record<string, unknown>,
  rowNumber: number,
  headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>>,
  seenNames: Map<string, number>,
): { row?: ImportRow; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const get = (key: keyof typeof PRODUCT_COLUMNS) => {
    const header = headerMap[key];
    return header ? raw[header] : undefined;
  };

  const name = text(get('name'));
  if (!name) {
    issues.push({ row: rowNumber, column: PRODUCT_COLUMNS.name, message: 'Product name is required.', severity: 'error' });
  } else if (name.length > MAX_NAME) {
    issues.push({
      row: rowNumber,
      column: PRODUCT_COLUMNS.name,
      message: `Product name is too long (maximum ${MAX_NAME} characters).`,
      severity: 'error',
    });
  }

  const priceResult = parsePrice(get('price'));
  if (!priceResult.ok) {
    issues.push({ row: rowNumber, column: PRODUCT_COLUMNS.price, message: priceResult.error, severity: 'error' });
  }

  const availabilityResult = parseAvailability(get('availability'));
  if (!availabilityResult.ok) {
    issues.push({
      row: rowNumber,
      column: PRODUCT_COLUMNS.availability,
      message: availabilityResult.error,
      severity: 'error',
    });
  }

  const description = text(get('description'));
  const category = text(get('category'));
  if (description.length > 1000) {
    issues.push({
      row: rowNumber,
      column: PRODUCT_COLUMNS.description,
      message: 'Description is too long (maximum 1000 characters).',
      severity: 'error',
    });
  }
  if (category.length > 60) {
    issues.push({
      row: rowNumber,
      column: PRODUCT_COLUMNS.category,
      message: 'Category is too long (maximum 60 characters).',
      severity: 'error',
    });
  }

  if (name) {
    const key = name.toLowerCase();
    const previous = seenNames.get(key);
    if (previous) {
      issues.push({
        row: rowNumber,
        column: PRODUCT_COLUMNS.name,
        message: `Duplicate of row ${previous}. Only the last one will be kept.`,
        severity: 'warning',
      });
    }
    seenNames.set(key, rowNumber);
  }

  if (issues.some((issue) => issue.severity === 'error')) return { issues };

  return {
    issues,
    row: {
      name,
      price: priceResult.ok ? priceResult.value : '0.00',
      availability: availabilityResult.ok ? availabilityResult.value : 'UNKNOWN',
      description: description || null,
      category: category || null,
      aliases: parseAliases(get('aliases')),
    },
  };
}

export function validateRows(
  rawRows: Array<{ rowNumber: number; values: Record<string, unknown> }>,
  headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>>,
  missingColumns: string[],
): ParsedProductImport {
  const issues: ImportIssue[] = missingColumns.map((column) => ({
    row: 1,
    column,
    message: `The "${column}" column is required. Download the template to get the expected columns.`,
    severity: 'error' as const,
  }));

  const rows: ImportRow[] = [];
  const seenNames = new Map<string, number>();
  const truncated = rawRows.length > MAX_ROWS;
  const limited = rawRows.slice(0, MAX_ROWS);

  for (const raw of limited) {
    const { row, issues: rowIssues } = validateRow(raw.values, raw.rowNumber, headerMap, seenNames);
    issues.push(...rowIssues);
    if (row) rows.push(row);
  }

  if (truncated) {
    issues.push({
      row: MAX_ROWS + 2,
      column: '-',
      message: `Only the first ${MAX_ROWS} rows are imported per file. Split the file and import the rest.`,
      severity: 'error',
    });
  }

  // Drop earlier duplicates so the same name is only created once.
  const deduped = new Map<string, ImportRow>();
  for (const row of rows) deduped.set(row.name.toLowerCase(), row);

  return {
    rows: [...deduped.values()],
    issues,
    headerMap,
    missingColumns,
    totalRows: rawRows.length,
  };
}
