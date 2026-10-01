import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MerchantProductsPage } from './ProductsPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { api } from '../../lib/api';
import type { ImportPreview, MerchantProduct } from '../../lib/types';

vi.mock('../../components/MerchantGate', () => ({
  MerchantGate: ({
    children,
    actions,
  }: {
    children: (context: { business: { id: string; name: string }; reload: () => void }) => React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      <h1>Products</h1>
      {actions}
      {children({ business: { id: 'biz-0001', name: 'Sharma Kirana' }, reload: () => undefined })}
    </div>
  ),
}));

function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: 'p1',
    name: 'Aashirvaad Atta 5kg',
    description: 'Whole wheat flour',
    category: 'Atta & rice',
    price: '265.00',
    currency: 'INR',
    availability: 'AVAILABLE',
    availabilityLabel: 'Available',
    aliases: ['atta'],
    isArchived: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('merchant product management', () => {
  it('lists products with their availability', async () => {
    vi.spyOn(api.merchant, 'products').mockResolvedValue({
      products: [product(), product({ id: 'p2', name: 'Gobindobhog Rice', availability: 'UNKNOWN' })],
    });

    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    expect(await screen.findByText('Aashirvaad Atta 5kg')).toBeInTheDocument();
    expect(screen.getByText('Gobindobhog Rice')).toBeInTheDocument();
  });

  it('shows an empty state for a new catalogue', async () => {
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [] });
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    expect(await screen.findByText(/has not published any products yet/)).toBeInTheDocument();
  });

  it('changes availability in place, including to Unknown', async () => {
    const update = vi.spyOn(api.merchant, 'updateProduct').mockResolvedValue({ product: product({ availability: 'UNKNOWN' }) });
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [product()] });

    const user = userEvent.setup();
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    await screen.findByText('Aashirvaad Atta 5kg');

    const select = screen.getByLabelText(/Availability/i, { selector: 'select' });
    await user.selectOptions(select, 'UNKNOWN');

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('biz-0001', 'p1', { availability: 'UNKNOWN' });
    });
  });

  it('offers exactly the three availability states in the product form', async () => {
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [] });

    const user = userEvent.setup();
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    await user.click(screen.getByRole('button', { name: /Add product/i }));

    const select = screen.getByLabelText(/^Availability/) as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN']);
    expect(screen.getByText(/never shown as Available/i)).toBeInTheDocument();
  });

  it('archives a product and reports it to the owner', async () => {
    const archive = vi.spyOn(api.merchant, 'archiveProduct').mockResolvedValue({ product: product({ isArchived: true }) });
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [product()] });

    const user = userEvent.setup();
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    await screen.findByText('Aashirvaad Atta 5kg');

    await user.click(screen.getByRole('button', { name: /Archive/i }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('biz-0001', 'p1'));
    expect(await screen.findByText(/hidden from customers/)).toBeInTheDocument();
  });

  it('rejects an import with row errors and saves nothing', async () => {
    const preview: ImportPreview = {
      mode: 'preview',
      filename: 'bad.csv',
      missingColumns: [],
      totalRows: 2,
      validRows: 1,
      invalidRows: 1,
      rows: [product() as never],
      issues: [
        { row: 3, column: 'Name', message: 'Product name is required.', severity: 'error' },
        { row: 4, column: 'Availability', message: 'Availability "perhaps" is not recognised.', severity: 'error' },
      ],
      canCommit: false,
    };
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [] });
    vi.spyOn(api.merchant, 'previewImport').mockResolvedValue(preview);
    const commit = vi.spyOn(api.merchant, 'commitImport');

    const user = userEvent.setup();
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });

    const input = screen.getByLabelText(/Choose .xlsx or .csv file/i);
    await user.upload(input, new File(['Name,Price'], 'bad.csv', { type: 'text/csv' }));

    // Row numbers and messages must be visible before anything is written.
    expect(await screen.findByText(/Row 3/)).toBeInTheDocument();
    expect(screen.getByText(/not recognised/)).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /Save 1 products/i });
    expect(saveButton).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('enables saving only for a clean preview and reports the result', async () => {
    const preview: ImportPreview = {
      mode: 'preview',
      filename: 'good.xlsx',
      missingColumns: [],
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      rows: [
        { name: 'Sugar 1kg', price: '45.00', availability: 'AVAILABLE', description: null, category: 'Grocery', aliases: [] },
        { name: 'Mystery Item', price: '10.00', availability: 'UNKNOWN', description: null, category: null, aliases: [] },
      ],
      issues: [],
      canCommit: true,
    };
    vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [] });
    vi.spyOn(api.merchant, 'previewImport').mockResolvedValue(preview);
    const commit = vi
      .spyOn(api.merchant, 'commitImport')
      .mockResolvedValue({ saved: true, created: 2, updated: 0, excluded: 0, warnings: [] });

    const user = userEvent.setup();
    renderWithProviders(<MerchantProductsPage />, {
      route: '/merchant/biz-0001/products',
      path: '/merchant/:businessId/products',
    });
    await user.upload(
      screen.getByLabelText(/Choose .xlsx or .csv file/i),
      new File(['x'], 'good.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    const saveButton = await screen.findByRole('button', { name: /Save 2 products/i });
    expect(saveButton).toBeEnabled();

    // The preview table must not upgrade Unknown to Available.
    const table = screen.getByRole('table');
    const unknownRow = within(table).getByText('Mystery Item').closest('tr')!;
    expect(within(unknownRow).getByText('Unknown')).toBeInTheDocument();

    await user.click(saveButton);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/2 added, 0 updated/)).toBeInTheDocument();
  });
});
