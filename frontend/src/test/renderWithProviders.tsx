import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../lib/i18n';
import { ToastProvider } from '../providers/ToastProvider';
import { CartProvider } from '../providers/CartProvider';
import { AuthProvider } from '../providers/AuthProvider';
import { FeaturesProvider } from '../providers/FeaturesProvider';
import type { LanguageCode } from '../lib/types';

export interface RenderOptions {
  /** The URL to render. */
  route?: string;
  /**
   * Route pattern to mount the element on, for example
   * '/merchant/:businessId/products'. Required whenever the component reads
   * useParams(), because params are only populated inside a matching Route.
   */
  path?: string;
  language?: LanguageCode;
}

/**
 * Renders a component inside the real provider stack used by main.tsx.
 *
 * Supabase is intentionally unconfigured in tests, so AuthProvider reports
 * `configured: false` and never attempts OAuth. fetch is stubbed in
 * src/test/setup.ts, so nothing reaches the network.
 */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { route = '/', path, language = 'en' } = options;

  if (language !== 'en') {
    window.localStorage.setItem('dukaansaathi.language', language);
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <I18nProvider>
          <ToastProvider>
            <FeaturesProvider>
              <AuthProvider>
                <CartProvider>
                  {path ? (
                    <Routes>
                      <Route path={path} element={children} />
                    </Routes>
                  ) : (
                    children
                  )}
                </CartProvider>
              </AuthProvider>
            </FeaturesProvider>
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
