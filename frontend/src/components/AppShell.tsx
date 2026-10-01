import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../providers/AuthProvider';
import { LanguageSelector } from './LanguageSelector';

export interface NavItem {
  to: string;
  label: string;
  /** Optional badge such as the cart count. */
  badge?: number;
  end?: boolean;
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-slate-100 hover:text-ink'
  }`;
}

/**
 * Shared layout: a top bar on desktop and a bottom tab bar on mobile, which is
 * how the reference design presents navigation. Every control is a real link or
 * button so keyboard and screen-reader users can move through the app.
 */
export function AppShell({
  children,
  nav,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  nav: NavItem[];
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const { signedIn, signOut, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const isMerchant = location.pathname.startsWith('/merchant');

  return (
    <div className="min-h-dvh bg-canvas pb-24 lg:pb-0">
      <a href="#main" className="sr-only sr-only-focusable">
        {t('app.skipToContent')}
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to={isMerchant ? '/merchant' : '/explore'} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-base font-bold text-white"
            >
              द
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold text-ink">{t('app.name')}</span>
              {isMerchant ? <span className="block text-xs text-ink-muted">{t('nav.merchantArea')}</span> : null}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <LanguageSelector />
            {signedIn ? (
              <div className="relative">
                <button
                  type="button"
                  className="btn-secondary px-3 py-2"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <span className="hidden sm:inline">{profile?.fullName ?? t('nav.account')}</span>
                  <span className="sm:hidden" aria-hidden="true">
                    👤
                  </span>
                  <span className="sr-only">{t('nav.account')}</span>
                </button>
                {menuOpen ? (
                  <div
                    className="card absolute right-0 mt-2 w-56 p-2"
                    role="menu"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <p className="px-3 py-2 text-xs text-ink-muted">
                      {t('auth.signedInAs', { email: profile?.email ?? '' })}
                    </p>
                    <Link
                      to="/account"
                      className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-50"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t('account.title')}
                    </Link>
                    {/* Mode switching is symmetric and does not require
                        signing out. A customer may also own a business; the
                        server decides what they can actually manage. */}
                    <Link
                      to="/merchant"
                      className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-50"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t('nav.manageBusiness')}
                    </Link>
                    <Link
                      to="/explore"
                      className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-50"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t('nav.exploreAsCustomer')}
                    </Link>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        // Return to the landing page so the signed-out state is
                        // unambiguous, instead of staying on a protected page.
                        void signOut().then(() => navigate('/'));
                      }}
                    >
                      {t('nav.signOut')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link to={isMerchant ? '/business/login' : '/auth/customer'} className="btn-primary px-3 py-2">
                {t('nav.signIn')}
              </Link>
            )}
          </div>
        </div>

        <nav aria-label={t('nav.menu')} className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 lg:flex">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
              {item.badge ? (
                <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{item.badge}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {title ? (
          <div className="mx-auto max-w-6xl px-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-ink sm:text-2xl">{title}</h1>
                {subtitle ? <p className="text-sm text-ink-muted">{subtitle}</p> : null}
              </div>
              {actions}
            </div>
          </div>
        ) : null}
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-5">
        {children}
      </main>

      {/* Mobile tab bar: large touch targets, matches the reference direction. */}
      <nav
        aria-label={t('nav.menu')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-3xl">
          {nav.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex min-h-touch flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold ${
                    isActive ? 'text-brand-700' : 'text-ink-muted'
                  }`
                }
              >
                <span className="text-center leading-tight">{item.label}</span>
                {item.badge ? (
                  <span className="absolute right-3 top-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
