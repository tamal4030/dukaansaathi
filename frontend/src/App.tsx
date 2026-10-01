import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from './lib/i18n';
import { LandingPage } from './pages/LandingPage';
import { CustomerSignInPage } from './pages/auth/CustomerSignInPage';
import { BusinessLoginPage } from './pages/auth/BusinessLoginPage';
import { BusinessSignUpPage } from './pages/auth/BusinessSignUpPage';
import { ExplorePage } from './pages/customer/ExplorePage';
import { BusinessPage } from './pages/customer/BusinessPage';
import { CartPage } from './pages/customer/CartPage';
import { CheckoutPage } from './pages/customer/CheckoutPage';
import { OrdersPage } from './pages/customer/OrdersPage';
import { OrderDetailPage } from './pages/customer/OrderDetailPage';
import { AccountPage } from './pages/customer/AccountPage';
import { OverviewPage } from './pages/merchant/OverviewPage';
import { MerchantOrdersPage } from './pages/merchant/OrdersPage';
import { MerchantOrderDetailPage } from './pages/merchant/OrderDetailPage';
import { MerchantProductsPage } from './pages/merchant/ProductsPage';
import { BusinessProfilePage } from './pages/merchant/BusinessProfilePage';
import { BusinessSetupPage } from './pages/merchant/BusinessSetupPage';
import { MerchantConversationsPage } from './pages/merchant/ConversationsPage';
import { MerchantReviewsPage } from './pages/merchant/ReviewsPage';

/**
 * Route segments that live under /merchant but are NOT business ids. If one of
 * these is ever matched as :businessId (for example an old bookmark to
 * /merchant/orders), send the visitor back to the overview instead of showing
 * "business not found".
 */
const RESERVED_MERCHANT_SEGMENTS = new Set([
  'orders',
  'products',
  'business',
  'conversations',
  'reviews',
  'setup',
]);

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-ink">{t('error.notFound')}</h1>
      <a href="/explore" className="btn-primary mt-4">
        {t('nav.explore')}
      </a>
    </div>
  );
}

/** Redirects /merchant/:businessId to that business's orders view. */
function MerchantBusinessHome() {
  const { businessId = '' } = useParams();
  if (RESERVED_MERCHANT_SEGMENTS.has(businessId)) {
    return <Navigate to="/merchant" replace />;
  }
  return <Navigate to={`/merchant/${businessId}/orders`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/business/:slug" element={<BusinessPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      <Route path="/account" element={<AccountPage />} />

      <Route path="/auth/customer" element={<CustomerSignInPage />} />
      <Route path="/business/login" element={<BusinessLoginPage />} />
      <Route path="/business/signup" element={<BusinessSignUpPage />} />

      <Route path="/merchant" element={<OverviewPage />} />
      <Route path="/merchant/setup" element={<BusinessSetupPage />} />
      <Route path="/merchant/reviews" element={<ReviewsRedirect />} />
      <Route path="/merchant/:businessId" element={<MerchantBusinessHome />} />
      <Route path="/merchant/:businessId/orders" element={<MerchantOrdersPage />} />
      <Route path="/merchant/:businessId/orders/:orderId" element={<MerchantOrderDetailPage />} />
      <Route path="/merchant/:businessId/products" element={<MerchantProductsPage />} />
      <Route path="/merchant/:businessId/business" element={<BusinessProfilePage />} />
      <Route path="/merchant/:businessId/conversations" element={<MerchantConversationsPage />} />
      <Route path="/merchant/:businessId/reviews" element={<MerchantReviewsPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/** Resolves the reviews screen for whichever business the owner has. */
function ReviewsRedirect() {
  const { businessId = '' } = useParams();
  return <Navigate to={businessId ? `/merchant/${businessId}/reviews` : '/merchant'} replace />;
}
