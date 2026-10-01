import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { LanguageSelector } from '../../components/LanguageSelector';

/**
 * Customer sign-in. Only Google OAuth is offered because the backend requires a
 * Google account before an order can be submitted. Browsing and chat never need
 * this screen.
 */
export function CustomerSignInPage() {
  const { t } = useI18n();
  const { signInWithGoogle, configured, signedIn, isGoogleUser, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t('common.somethingWentWrong'));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <Link to="/" className="text-lg font-bold text-ink">
          {t('app.name')}
        </Link>
        <LanguageSelector />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-12">
        <div className="card p-6">
          <h1 className="text-2xl font-bold text-ink">{t('auth.customerSignIn')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('auth.customerSignInIntro')}</p>

          {!configured ? (
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p className="font-semibold">{t('auth.googleNotConfigured')}</p>
              <p className="mt-1">{t('auth.notConfigured')}</p>
            </div>
          ) : null}

          {signedIn ? (
            <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <p>{t('auth.signedInAs', { email: profile?.email ?? '' })}</p>
              {!isGoogleUser ? <p className="mt-1">{t('checkout.signInRequired')}</p> : null}
              <div className="mt-3 flex gap-2">
                <Link to="/orders" className="btn-primary">
                  {t('orders.title')}
                </Link>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void signOut().then(() => navigate('/'))}
                >
                  {t('nav.signOut')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary mt-5 w-full py-3"
              onClick={() => void start()}
              disabled={busy || !configured}
            >
              {busy ? t('common.loading') : t('auth.continueWithGoogle')}
            </button>
          )}

          {error ? (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <p className="mt-4 text-xs text-ink-soft">{t('auth.whyGoogle')}</p>

          <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
            <p className="text-ink-muted">
              {t('auth.customerBrowsing')}{' '}
              <Link to="/explore" className="font-semibold text-brand-700 hover:underline">
                {t('auth.goToExplore')}
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
