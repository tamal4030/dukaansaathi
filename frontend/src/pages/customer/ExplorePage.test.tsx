import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorePage } from './ExplorePage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { api } from '../../lib/api';
import type { PublicBusiness } from '../../lib/types';

/**
 * Guests must be able to browse the directory without any account, so this
 * suite stubs only the API client (not the backend contract).
 */
function business(overrides: Partial<PublicBusiness> = {}): PublicBusiness {
  return {
    id: 'biz-0001',
    name: 'Sharma Kirana & General Store',
    slug: 'demo-sharma-kirana',
    category: 'GROCERY_DAILY_ESSENTIALS',
    categoryLabel: 'Grocery & daily essentials',
    description: 'Neighbourhood kirana shop',
    publicPhone: '+91 98300 11223',
    publicEmail: null,
    address: { line: '14 Bidhan Sarani', city: 'Kolkata', state: 'West Bengal', pincode: '700006', latitude: null, longitude: null },
    openState: 'open',
    hours: [],
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryNotes: null,
    paymentMethods: [],
    returnPolicy: null,
    faqs: [],
    productCount: 7,
    ...overrides,
  };
}

const META = {
  categories: [
    { id: 'GROCERY_DAILY_ESSENTIALS', slug: 'grocery-daily-essentials', label: 'Grocery & daily essentials' },
    { id: 'FASHION_TEXTILES', slug: 'fashion-textiles', label: 'Fashion & textiles' },
  ],
  availability: [
    { id: 'AVAILABLE' as const, label: 'Available' },
    { id: 'OUT_OF_STOCK' as const, label: 'Out of stock' },
    { id: 'UNKNOWN' as const, label: 'Availability unknown' },
  ],
  orderStatuses: [],
  reviewTags: [],
  languages: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  // ExplorePage loads category labels from /api/meta so the dropdown never
  // shows a raw enum value.
  vi.spyOn(api, 'meta').mockResolvedValue(META as never);
});

describe('ExplorePage (guest browsing)', () => {
  it('lists businesses returned by the API', async () => {
    vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 1, businesses: [business()] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);

    const heading = await screen.findByRole('heading', { name: 'Sharma Kirana & General Store' });
    // Scope to the card: the category label also appears in the filter dropdown.
    const card = heading.closest('a')!;
    expect(within(card).getByText('Grocery & daily essentials')).toBeInTheDocument();
    expect(within(card).getByText(/Bidhan Sarani/)).toBeInTheDocument();
  });

  it('shows an open/closed/unknown state without inventing hours', async () => {
    vi.spyOn(api.businesses, 'list').mockResolvedValue({
      total: 3,
      businesses: [
        business({ id: 'b1', name: 'Open Shop', openState: 'open' }),
        business({ id: 'b2', name: 'Closed Shop', openState: 'closed' }),
        business({ id: 'b3', name: 'Unknown Shop', openState: 'unknown' }),
      ],
    });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);
    await screen.findByText('Open Shop');

    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Hours not published')).toBeInTheDocument();
  });

  it('renders an empty state when nothing matches', async () => {
    vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 0, businesses: [] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);
    expect(await screen.findByText(/No shops match your search/)).toBeInTheDocument();
  });

  it('renders an error state with a retry action when the API fails', async () => {
    vi.spyOn(api.businesses, 'list').mockRejectedValue(new Error('The server could not be reached.'));
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('filters by search text through the API', async () => {
    const list = vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 0, businesses: [] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    const user = userEvent.setup();
    renderWithProviders(<ExplorePage />);
    await user.type(screen.getByLabelText(/Search shops/i), 'saree');

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: 'saree' }));
    });
  });

  it('filters by category through the API', async () => {
    const list = vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 0, businesses: [] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    const user = userEvent.setup();
    renderWithProviders(<ExplorePage />);
    await user.selectOptions(screen.getByLabelText(/Category/i, { selector: 'select' }), 'FASHION_TEXTILES');

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ category: 'FASHION_TEXTILES' }));
    });
  });

  it('switches to the Recently accessed view and explains when it is empty', async () => {
    vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 1, businesses: [business()] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    const user = userEvent.setup();
    renderWithProviders(<ExplorePage />);
    await screen.findByText('Sharma Kirana & General Store');

    await user.click(screen.getByRole('tab', { name: /Recently accessed/i }));
    expect(await screen.findByText(/Saved to your account so they follow you across devices/)).toBeInTheDocument();
  });

  it('labels the category filter from /api/meta rather than from loaded results', async () => {
    // No businesses at all: the old implementation would have shown raw enums.
    vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 0, businesses: [] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);
    const select = await screen.findByLabelText(/Category/i, { selector: 'select' });
    const labels = Array.from((select as HTMLSelectElement).options).map((option) => option.textContent);
    expect(labels).toContain('Grocery & daily essentials');
    expect(labels).toContain('Fashion & textiles');
    expect(labels).not.toContain('GROCERY_DAILY_ESSENTIALS');
  });

  it('has both All and Recently accessed views for keyboard users', async () => {
    vi.spyOn(api.businesses, 'list').mockResolvedValue({ total: 0, businesses: [] });
    vi.spyOn(api.businesses, 'recent').mockResolvedValue({ businesses: [] });

    renderWithProviders(<ExplorePage />);
    const all = screen.getByRole('tab', { name: /All shops/i });
    const recent = screen.getByRole('tab', { name: /Recently accessed/i });
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(recent).toHaveAttribute('aria-selected', 'false');
  });
});
