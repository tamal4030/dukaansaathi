import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { badRequest } from '../../lib/errors';
import {
  canonicalHeader,
  cellToText,
  ParsedProductImport,
  PRODUCT_COLUMNS,
  REQUIRED_COLUMNS,
  TEMPLATE_SHEET,
  validateRows,
} from './schema';

type RawRow = { rowNumber: number; values: Record<string, unknown> };

function mapHeaders(headerCells: string[]): {
  headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>>;
  missingColumns: string[];
} {
  const headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>> = {};
  headerCells.forEach((cell) => {
    const canonical = canonicalHeader(cell);
    if (canonical && !headerMap[canonical]) headerMap[canonical] = cell.trim();
  });
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headerMap[column]).map(
    (column) => PRODUCT_COLUMNS[column],
  );
  return { headerMap, missingColumns };
}

function rowsFromMatrix(matrix: string[][]): { rawRows: RawRow[]; headerMap: Partial<Record<keyof typeof PRODUCT_COLUMNS, string>>; missingColumns: string[] } {
  const headerIndex = matrix.findIndex((cells) => canonicalHeader(cells[0] ?? '') === 'name' ||
    cells.some((cell) => canonicalHeader(cell) === 'name'));
  if (headerIndex === -1) {
    throw badRequest(
      'No header row found. The first row must contain the column names (Name, Price, Availability, Description, Category, Alternate names).',
    );
  }
  const headerCells = matrix[headerIndex].map((cell) => String(cell ?? ''));
  const { headerMap, missingColumns } = mapHeaders(headerCells);

  const rawRows: RawRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    if (!cells || cells.every((cell) => String(cell ?? '').trim() === '')) continue;
    const values: Record<string, unknown> = {};
    headerCells.forEach((header, columnIndex) => {
      if (!header) return;
      values[header.trim()] = cells[columnIndex] ?? '';
    });
    rawRows.push({ rowNumber: index + 1, values });
  }
  return { rawRows, headerMap, missingColumns };
}

/** ExcelJS declares its own global `Buffer extends ArrayBuffer`, so cast once. */
type ExcelJsLoadArg = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJsLoadArg);
  } catch {
    throw badRequest('That file could not be read as an .xlsx workbook. Re-download the template and try again.');
  }
  const sheet =
    workbook.getWorksheet(TEMPLATE_SHEET) ??
    workbook.worksheets.find((worksheet) => worksheet.name.toLowerCase() !== 'how to use this template') ??
    workbook.worksheets[0];
  if (!sheet) throw badRequest('The workbook does not contain any worksheet.');

  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cells[columnNumber - 1] = cellToText(cell.value);
    });
    for (let index = 0; index < cells.length; index += 1) {
      if (typeof cells[index] !== 'string') cells[index] = '';
    }
    matrix.push(cells);
  });
  return matrix;
}

function readCsv(buffer: Buffer): string[][] {
  const result = Papa.parse<string[]>(buffer.toString('utf8'), { skipEmptyLines: 'greedy' });
  return (result.data ?? []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
}

export async function parseProductFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedProductImport> {
  if (!buffer || buffer.length === 0) throw badRequest('The uploaded file is empty.');
  const lower = filename.toLowerCase();
  const matrix = lower.endsWith('.csv') ? readCsv(buffer) : await readXlsx(buffer);
  if (matrix.length === 0) throw badRequest('The uploaded file has no rows.');
  const { rawRows, headerMap, missingColumns } = rowsFromMatrix(matrix);
  return validateRows(rawRows, headerMap, missingColumns);
}
