import ExcelJS from 'exceljs';
import type { Product } from '@prisma/client';
import { availabilityLabel } from '../../lib/availability';
import { INSTRUCTIONS_SHEET, PRODUCT_COLUMNS, TEMPLATE_SHEET } from './schema';

const columns = [
  { header: PRODUCT_COLUMNS.name, key: 'name', width: 34 },
  { header: PRODUCT_COLUMNS.price, key: 'price', width: 12 },
  { header: PRODUCT_COLUMNS.availability, key: 'availability', width: 18 },
  { header: PRODUCT_COLUMNS.description, key: 'description', width: 44 },
  { header: PRODUCT_COLUMNS.category, key: 'category', width: 22 },
  { header: PRODUCT_COLUMNS.aliases, key: 'aliases', width: 32 },
];

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  row.height = 22;
  row.alignment = { vertical: 'middle' };
}

function buildWorkbook(rows: Array<Record<string, string>>, withInstructions: boolean): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DukaanSaathi';
  const sheet = workbook.addWorksheet(TEMPLATE_SHEET);
  sheet.columns = columns;
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((row) => sheet.addRow(row));

  sheet.getColumn('availability').eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber === 1) return;
    const value = String(cell.value ?? '');
    if (value === 'Available') cell.font = { color: { argb: 'FF15803D' } };
    else if (value === 'Out of stock') cell.font = { color: { argb: 'FFB91C1C' } };
    else if (value) cell.font = { color: { argb: 'FFB45309' } };
  });

  if (withInstructions) {
    const info = workbook.addWorksheet(INSTRUCTIONS_SHEET);
    info.columns = [{ width: 28 }, { width: 96 }];
    const lines: Array<[string, string]> = [
      ['DukaanSaathi product import', 'Fill the "Products" sheet and upload this file in Business > Products > Import.'],
      ['Name (required)', 'The product name customers see. Keep it short, for example "Aashirvaad Atta 5kg".'],
      ['Price (required)', 'Price in INR. Numbers only, for example 249 or 249.50. Do not add text.'],
      [
        'Availability (required)',
        'One of: Available, Out of stock, Unknown. Use Unknown when you have not checked the shelf. Unknown is never shown as Available.',
      ],
      ['Description (optional)', 'A short line about the product. Do not paste marketing text from other websites.'],
      ['Category (optional)', 'Your own grouping, for example "Atta & rice". Helps customers search.'],
      [
        'Alternate names (optional)',
        'Other names customers may use, separated by commas. Example: atta, aata, wheat flour. Important for Bengali and Hindi search.',
      ],
      ['CSV support', 'You can also upload a CSV with the same six columns in the same order.'],
      [
        'Example row (for reference only)',
        'Name: Aashirvaad Atta 5kg | Price: 265.00 | Availability: Available | Description: Whole wheat flour | Category: Atta & rice | Alternate names: atta, aata, wheat flour',
      ],
      [
        'Why the Products sheet is empty',
        'So that nothing can be imported as real inventory by accident. Type or paste your own rows into the Products sheet, starting at row 2.',
      ],
      ['Availability values', 'Use exactly Available, Out of stock or Unknown. Unknown is never shown as Available to customers.'],
      ['Tips', 'Keep one product per row. Re-uploading a name that already exists updates that product instead of duplicating it.'],
    ];
    lines.forEach(([label, value], index) => {
      const row = info.addRow([label, value]);
      if (index === 0) {
        row.font = { bold: true, size: 13 };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      } else {
        row.getCell(1).font = { bold: true };
      }
      row.alignment = { vertical: 'top', wrapText: true };
      row.height = 30;
    });
  }

  return workbook;
}

export async function buildProductsWorkbook(
  products: Product[],
  options: { withInstructions: boolean },
): Promise<Buffer> {
  const rows = products.map((product) => ({
    name: product.name,
    price: Number(product.price).toFixed(2),
    availability: availabilityLabel(product.availability),
    description: product.description ?? '',
    category: product.category ?? '',
    aliases: product.aliases.join(', '),
  }));
  const workbook = buildWorkbook(rows, options.withInstructions);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as unknown as ArrayBuffer);
}

function csvCell(value: string): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildProductsCsv(products: Product[]): string {
  const header = Object.values(PRODUCT_COLUMNS).join(',');
  const lines = products.map((product) =>
    [
      product.name,
      Number(product.price).toFixed(2),
      availabilityLabel(product.availability),
      product.description ?? '',
      product.category ?? '',
      product.aliases.join('; '),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

/**
 * The Products sheet is intentionally left EMPTY.
 *
 * Earlier versions wrote an example product row into it, which merchants could
 * import by accident and end up with fake inventory. The example now lives on
 * the instructions sheet as text only, where it cannot be imported.
 */
export async function buildImportTemplate(_options: { withSample: boolean } = { withSample: false }): Promise<Buffer> {
  const workbook = buildWorkbook([], true);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as unknown as ArrayBuffer);
}
