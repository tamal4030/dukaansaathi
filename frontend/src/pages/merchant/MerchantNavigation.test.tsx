import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../lib/i18n';
import { ToastProvider } from '../../providers/ToastProvider';
import { FeaturesProvider } from '../../providers/FeaturesProvider';
import { AuthProvider } from '../../providers/AuthProvider';
import { CartProvider } from '../../providers/CartProvider';
import { api } from '../../lib/api';
import { OverviewPage } from './OverviewPage';
import { MerchantOrdersPage } from './OrdersPage';
import { MerchantProductsPage } from './ProductsPage';
import { BusinessProfilePage } from './BusinessProfilePage';
import type { MerchantBusiness } from '../../lib/types';

/**
 * MerchantGate redirects to the login page when nobody is signed in. Supabase
 * is unconfigured in tests, so the real provider always reports signed-out;
 * this mock supplies a signed-in owner instead of weakening the gate.
 */
vi.mock('../../providers/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../../providers/AuthProvider')>(
    '../../providers/AuthProvider',
  );
  return {
    ...actual,
    useAuth: () => ({
      session: { user: { id: 'owner-1' } },
      profile: {
        id: 'profile-owner',
        email: 'owner@example.com',
        fullName: 'Rakesh Sharma',
        phone: null,
        locale: 'en' as const,
        role: 'BUSINESS_OWNER' as const,
        signInProvider: 'email',
        emailNotificationsOptIn: true,
      },
      loading: false,
      signedIn: true,
      isGoogleUser: false,
      isBusinessUser: true,
      configured: true,
      signUpBusiness: async () => ({ needsConfirmation: false }),
      signInBusiness: async () => undefined,
      signInWithGoogle: async () => undefined,
      signOut: async () => undefined,
      refreshProfile: async () => undefined,
      updateProfile: async () => {
        throw new Error('not used in this test');
      },
    }),
  };
});

/**
 * Regression tests for the merchant navigation bug.
 *
 * The original defect: MerchantGate built its links from the raw route param,
 * so opening /merchant produced /merchant/orders. The router matches that
 * against /merchant/:businessId, so "orders" was read as a BUSINESS ID and the
 * Orders tab navigated to a non-existent business.
 *
 * These tests start at /merchant (no business id in the route) and follow the
 * real links, which is the exact path a user takes.
 */
const BUSINESS_ID = '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f';

function merchantBusiness(): MerchantBusiness {
  return {
    id: BUSINESS_ID,
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
    ownerId: 'owner-1',
    isActive: true,
    isPublic: true,
    assistantNotes: null,
    emailNotificationsOptIn: true,
    emailNotificationsEmail: 'shop@example.com',
    createdAt: new Date().toISOString(),
  };
}

/** Renders the merchant route tree so real navigation between tabs is exercised. */
function renderMerchantApp(initialRoute: string) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <I18nProvider>
        <ToastProvider>
          <FeaturesProvider>
            <AuthProvider>
              <CartProvider>
                <Routes>
                  <Route path="/merchant" element={<OverviewPage />} />
                  <Route path="/merchant/:businessId/orders" element={<MerchantOrdersPage />} />
                  <Route path="/merchant/:businessId/products" element={<MerchantProductsPage />} />
                  <Route path="/merchant/:businessId/business" element={<BusinessProfilePage />} />
                </Routes>
              </CartProvider>
            </AuthProvider>
          </FeaturesProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.merchant, 'listBusinesses').mockResolvedValue({ businesses: [merchantBusiness()] });
  vi.spyOn(api.merchant, 'getBusiness').mockResolvedValue({ business: merchantBusiness(), role: 'OWNER' });
  vi.spyOn(api.merchant, 'orders').mockResolvedValue({ orders: [], counts: [] });
  vi.spyOn(api.merchant, 'products').mockResolvedValue({ products: [] });
  vi.spyOn(api.merchant, 'overview').mockResolvedValue({
    needsAttention: { newOrders: 0, openConversations: 0, total: 0 },
    inProgressOrders: 0,
    completedOrders: 0,
    topProducts: [],
    rating: { average: null, count: 0 },
    recentReviews: [],
    productAvailability: [],
    recentOrders: [],
  });
});

describe('merchant navigation from /merchant', () => {
  it('builds the Orders link from the resolved business id, not the route param', async () => {
    const user = userEvent.setup();
    renderMerchantApp('/merchant');

    // The overview resolves the business before it can render tab links.
    const nav = screen.getAllByRole('navigation')[0];
    const ordersLink = await within(nav).findByRole('link', { name: /^Orders$/ });
    // The bug produced "/merchant/orders" here.
    expect(ordersLink).toHaveAttribute('href', `/merchant/${BUSINESS_ID}/orders`);

    await user.click(ordersLink);

    // The Orders screen must actually load rather than resolve a fake business.
    await waitFor(() => {
      expect(api.merchant.orders).toHaveBeenCalledWith(BUSINESS_ID, expect.anything());
    });
    expect(await screen.findByText(/No orders yet/i)).toBeInTheDocument();
    // The bug would have requested a business whose id is the word "orders".
    expect(api.merchant.getBusiness).not.toHaveBeenCalledWith('orders');
  });

  it('navigates to Products using the real business id', async () => {
    const user = userEvent.setup();
    renderMerchantApp('/merchant');

    const nav = screen.getAllByRole('navigation')[0];
    const link = await within(nav).findByRole('link', { name: /^Products$/ });
    expect(link).toHaveAttribute('href', `/merchant/${BUSINESS_ID}/products`);

    await user.click(link);
    await waitFor(() => {
      expect(api.merchant.products).toHaveBeenCalledWith(BUSINESS_ID, expect.anything());
    });
    // Prove the destination screen rendered, not just that an API call fired.
    // Level 1 is required because the page renders both an h1 ("Products") and
    // a SectionHeading h2 ("Products").
    expect(await screen.findByRole('heading', { level: 1, name: /^Products$/ })).toBeInTheDocument();
    // And prove no request was made for a business literally called "products".
    expect(api.merchant.getBusiness).not.toHaveBeenCalledWith('products');
  });

  it('navigates to Business using the real business id', async () => {
    const user = userEvent.setup();
    renderMerchantApp('/merchant');

    const nav = screen.getAllByRole('navigation')[0];
    const link = await within(nav).findByRole('link', { name: /^Business$/ });
    expect(link).toHaveAttribute('href', `/merchant/${BUSINESS_ID}/business`);

    await user.click(link);
    await waitFor(() => {
      expect(api.merchant.getBusiness).toHaveBeenCalledWith(BUSINESS_ID);
    });
    expect(await screen.findByRole('heading', { name: /Business profile/i })).toBeInTheDocument();
    expect(api.merchant.getBusiness).not.toHaveBeenCalledWith('business');
  });

  it('keeps the Overview link pointing at /merchant', async () => {
    renderMerchantApp('/merchant');

    const nav = screen.getAllByRole('navigation')[0];
    expect(await within(nav).findByRole('link', { name: /^Overview$/ })).toHaveAttribute('href', '/merchant');
  });

  it('does not list businesses when the route already names one', async () => {
    renderMerchantApp(`/merchant/${BUSINESS_ID}/orders`);

    await waitFor(() => {
      expect(api.merchant.getBusiness).toHaveBeenCalledWith(BUSINESS_ID);
    });
    // Fetching the list as well would be a wasted round trip on every screen.
    expect(api.merchant.listBusinesses).not.toHaveBeenCalled();
  });

  it('offers a symmetric link back to customer browsing', async () => {
    renderMerchantApp('/merchant');
    await waitFor(() => expect(api.merchant.listBusinesses).toHaveBeenCalled());
    const links = await screen.findAllByRole('link', { name: /Explore as a customer/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/explore');
  });
});
