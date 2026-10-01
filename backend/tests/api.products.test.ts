import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { authHeader, buildTestApp, seedBusiness, testToken, type TestApp } from './helpers';
import { parseProductFile } from '../src/services/products/importService';
import { buildProductsWorkbook } from '../src/services/products/exportService';

let ctx: TestApp;
const OWNER = testToken({ sub: 'owner-1' });

beforeEach(() => {
  ctx = buildTestApp();
  seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
});

async function xlsxBuffer(rows: Array<Record<string, string>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.columns = [
    { header: 'Name', key: 'name' },
    { header: 'Price', key: 'price' },
    { header: 'Availability', key: 'availability' },
    { header: 'Description', key: 'description' },
    { header: 'Category', key: 'category' },
    { header: 'Alternate names', key: 'aliases' },
  ];
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

/**
 * superagent only decodes known content types. Spreadsheet responses need an
 * explicit binary parser, otherwise `res.body` is an empty object.
 */
function binaryParser(res: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('product import (acceptance 4 and 5)', () => {
  it('previews a valid XLSX without saving anything', async () => {
    const file = await xlsxBuffer([
      { name: 'Sugar 1kg', price: '45', availability: 'Available', description: 'Refined sugar', category: 'Grocery', aliases: 'chini, sugar' },
      { name: 'Tea Leaves 250g', price: '180.50', availability: 'Out of stock', description: '', category: 'Beverages', aliases: '' },
    ]);

    const before = ctx.prisma.tables.product.length;
    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import')
      .set(authHeader(OWNER))
      .attach('file', file, 'products.xlsx')
      .expect(200);

    expect(response.body.mode).toBe('preview');
    expect(response.body.validRows).toBe(2);
    expect(response.body.invalidRows).toBe(0);
    expect(response.body.canCommit).toBe(true);
    expect(response.body.rows[0].name).toBe('Sugar 1kg');
    expect(response.body.rows[0].price).toBe('45.00');
    expect(response.body.rows[0].availability).toBe('AVAILABLE');
    expect(response.body.rows[0].aliases).toEqual(['chini', 'sugar']);
    // Preview must not write.
    expect(ctx.prisma.tables.product.length).toBe(before);
  });

  it('imports a valid CSV on commit', async () => {
    const csv = [
      'Name,Price,Availability,Description,Category,Alternate names',
      'Sugar 1kg,45,Available,Refined sugar,Grocery,"chini, sugar"',
      'Gobindobhog Rice 1kg,95,Unknown,Aromatic rice,Atta & rice,chal',
    ].join('\n');

    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import?mode=commit')
      .set(authHeader(OWNER))
      .attach('file', csvBuffer(csv), 'products.csv')
      .expect(201);

    expect(response.body.saved).toBe(true);
    // 'Sugar 1kg' is new; 'Gobindobhog Rice 1kg' already exists and is updated.
    expect(response.body.created).toBe(1);
    expect(response.body.updated).toBe(1);
    expect(response.body.created + response.body.updated).toBe(2);

    const sugar = ctx.prisma.tables.product.find((product) => product.name === 'Sugar 1kg');
    expect(sugar.availability).toBe('AVAILABLE');
    expect(sugar.aliases).toEqual(['chini', 'sugar']);
    const rice = ctx.prisma.tables.product.find((product) => product.name === 'Gobindobhog Rice 1kg');
    // Unknown stays Unknown: it is never upgraded to Available.
    expect(rice.availability).toBe('UNKNOWN');
    // Re-importing must not duplicate rows.
    expect(ctx.prisma.tables.product.filter((product) => product.name === 'Gobindobhog Rice 1kg')).toHaveLength(1);
  });

  it('reports understandable row and column errors for invalid rows', async () => {
    const csv = [
      'Name,Price,Availability,Description,Category,Alternate names',
      'Good Item,100,Available,,,',
      ',50,Available,,,',
      'No Price,abc,Available,,,',
      'Bad Availability,20,perhaps,,,',
    ].join('\n');

    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import')
      .set(authHeader(OWNER))
      .attach('file', csvBuffer(csv), 'bad.csv')
      .expect(200);

    expect(response.body.canCommit).toBe(false);
    expect(response.body.validRows).toBe(1);
    expect(response.body.invalidRows).toBe(3);

    const messages = response.body.issues.map((issue: { message: string }) => issue.message).join(' | ');
    expect(messages).toContain('Product name is required');
    expect(messages).toContain('not a valid amount');
    expect(messages).toContain('Availability "perhaps" is not recognised');
    expect(messages).toContain('Available, Out of stock or Unknown');

    // Each issue carries a row number and column for the preview table.
    const nameIssue = response.body.issues.find((issue: { message: string }) => issue.message.includes('name is required'));
    expect(nameIssue.row).toBe(3);
    expect(nameIssue.column).toBe('Name');
  });

  it('refuses to commit while errors remain, and saves nothing', async () => {
    const csv = ['Name,Price,Availability', 'Broken,not-a-price,Available'].join('\n');
    const before = ctx.prisma.tables.product.length;
    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import?mode=commit')
      .set(authHeader(OWNER))
      .attach('file', csvBuffer(csv), 'broken.csv')
      .expect(400);
    expect(response.body.error.message).toContain('nothing was saved');
    expect(ctx.prisma.tables.product.length).toBe(before);
  });

  it('reports a missing required column', async () => {
    const csv = ['Name,Description', 'Sugar,Refined'].join('\n');
    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import')
      .set(authHeader(OWNER))
      .attach('file', csvBuffer(csv), 'missing.csv')
      .expect(200);
    expect(response.body.missingColumns).toContain('Price');
    expect(response.body.missingColumns).toContain('Availability');
    expect(response.body.canCommit).toBe(false);
  });

  it('rejects a file that is not xlsx or csv', async () => {
    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import')
      .set(authHeader(OWNER))
      .attach('file', Buffer.from('{"products": []}'), 'products.json')
      .expect(400);
    expect(response.body.error.message).toContain('.xlsx or .csv');
  });

  it('treats a blank availability cell as Unknown, never Available', async () => {
    const csv = ['Name,Price,Availability', 'Mystery Item,10,'].join('\n');
    await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import?mode=commit')
      .set(authHeader(OWNER))
      .attach('file', csvBuffer(csv), 'blank.csv')
      .expect(201);
    const item = ctx.prisma.tables.product.find((product) => product.name === 'Mystery Item');
    expect(item.availability).toBe('UNKNOWN');
  });

  it('does not let another business owner import into this business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    const csv = ['Name,Price,Availability', 'Injected,1,Available'].join('\n');
    await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products/import?mode=commit')
      .set(authHeader(testToken({ sub: 'owner-2' })))
      .attach('file', csvBuffer(csv), 'products.csv')
      .expect(404);
    expect(ctx.prisma.tables.product.some((product) => product.name === 'Injected')).toBe(false);
  });
});

describe('product templates and export', () => {
  it('serves a documented XLSX template whose Products sheet has no importable example row', async () => {
    const response = await request(ctx.app)
      .get('/api/merchant/businesses/biz-0001/products/template')
      .set(authHeader(OWNER))
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
    const products = workbook.getWorksheet('Products');
    const instructions = workbook.getWorksheet('How to use this template');
    expect(products).toBeTruthy();
    expect(instructions).toBeTruthy();

    // Headers are present...
    expect(products!.getRow(1).getCell(1).value).toBe('Name');
    expect(products!.getRow(1).getCell(3).value).toBe('Availability');

    // ...but there is NO product data row. A merchant must not be able to
    // import a shipped example as real inventory.
    //
    // NOTE: rowCount is asserted BEFORE any getRow(2) call, because ExcelJS's
    // getRow(n) CREATES the row when it does not exist, which would make this
    // assertion observe its own side effect.
    expect(products!.rowCount).toBe(1);
    expect(products!.actualRowCount).toBe(1);

    // The example still exists, as text on the instructions sheet.
    const instructionText = instructions!
      .getColumn(2)
      .values.map((value) => String(value ?? ''))
      .join(' | ');
    expect(instructionText).toContain('Aashirvaad Atta 5kg');
  });

  it('serves a CSV-compatible template', async () => {
    const response = await request(ctx.app)
      .get('/api/merchant/businesses/biz-0001/products/template?format=csv')
      .set(authHeader(OWNER))
      .expect(200);
    expect(response.text).toContain('Name,Price,Availability,Description,Category,Alternate names');
  });

  it('exports products as CSV with availability labels', async () => {
    const response = await request(ctx.app)
      .get('/api/merchant/businesses/biz-0001/products/export?format=csv')
      .set(authHeader(OWNER))
      .expect(200);
    expect(response.text).toContain('Aashirvaad Atta 5kg');
    expect(response.text).toContain('Availability unknown');
  });

  /**
   * The exported workbook must be re-importable unchanged. This runs the
   * export/import services directly so the compatibility contract is tested
   * without depending on supertest's binary response handling.
   */
  it('round-trips an XLSX export back through the importer', async () => {
    const products = await ctx.prisma.product.findMany({ where: { businessId: 'biz-0001', isArchived: false } });
    const workbook = await buildProductsWorkbook(products as never, { withInstructions: false });
    expect(Buffer.isBuffer(workbook)).toBe(true);

    const parsed = await parseProductFile(workbook, 'export.xlsx');
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(parsed.rows).toHaveLength(3);

    const unknown = parsed.rows.find((row) => row.name.includes('Rice'));
    expect(unknown?.availability).toBe('UNKNOWN');
    const available = parsed.rows.find((row) => row.name.includes('Atta'));
    expect(available?.availability).toBe('AVAILABLE');
    expect(available?.aliases).toContain('atta');
  });
});

describe('product CRUD', () => {
  it('creates, edits availability and archives a product', async () => {
    const created = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(OWNER))
      .send({ name: 'Sugar 1kg', price: 45, availability: 'UNKNOWN', aliases: ['chini'] })
      .expect(201);
    expect(created.body.product.availability).toBe('UNKNOWN');
    expect(created.body.product.price).toBe('45.00');

    const updated = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/products/${created.body.product.id}`)
      .set(authHeader(OWNER))
      .send({ availability: 'AVAILABLE' })
      .expect(200);
    expect(updated.body.product.availability).toBe('AVAILABLE');

    await request(ctx.app)
      .delete(`/api/merchant/businesses/biz-0001/products/${created.body.product.id}`)
      .set(authHeader(OWNER))
      .expect(200);

    const list = await request(ctx.app)
      .get('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(OWNER))
      .expect(200);
    expect(list.body.products.some((product: { name: string }) => product.name === 'Sugar 1kg')).toBe(false);

    // The archived product is hidden from customers but not deleted.
    const publicList = await request(ctx.app).get('/api/businesses/biz-0001/products').expect(200);
    expect(publicList.body.products.some((product: { name: string }) => product.name === 'Sugar 1kg')).toBe(false);
    expect(ctx.prisma.tables.product.find((product) => product.name === 'Sugar 1kg').isArchived).toBe(true);
  });

  it('rejects an invalid availability value on create', async () => {
    const response = await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(OWNER))
      .send({ name: 'Odd', price: 10, availability: 'MAYBE' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const issues = response.body.error.details.issues as Array<{ path: string; message: string }>;
    expect(issues.some((issue) => issue.path === 'availability')).toBe(true);
    expect(issues.find((issue) => issue.path === 'availability')?.message).toContain('Availability must be');
  });

  it('rejects a negative price and an empty name', async () => {
    await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(OWNER))
      .send({ name: 'Free', price: -5, availability: 'AVAILABLE' })
      .expect(400);
    await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(OWNER))
      .send({ name: '', price: 5, availability: 'AVAILABLE' })
      .expect(400);
  });

  it('keeps product edits scoped to the owning business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    await request(ctx.app)
      .patch('/api/merchant/businesses/biz-0002/products/biz-0001-product-1')
      .set(authHeader(testToken({ sub: 'owner-2' })))
      .send({ price: 1 })
      .expect(404);
  });
});
