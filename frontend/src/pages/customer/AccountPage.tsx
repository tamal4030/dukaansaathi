import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { useToast } from '../../providers/ToastProvider';
import { AppShell } from '../../components/AppShell';
import { BusinessCard } from '../../components/BusinessCard';
import { EmptyState, ErrorState, Field, LoadingState, TextInput } from '../../components/ui';

export function AccountPage() {
  const { t } = useI18n();
  const { signedIn, configured, profile, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const { push } = useToast();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const recent = useAsync(() => (signedIn ? api.account.recent() : Promise.resolve({ businesses: [] })), [signedIn]);

  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
    setOptIn(profile?.emailNotificationsOptIn ?? false);
  }, [profile?.id, profile?.fullName, profile?.phone, profile?.emailNotificationsOptIn]);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/orders', label: t('nav.orders') },
      { to: '/account', label: t('nav.account'), end: true },
    ],
    [t],
  );

  if (!signedIn) {
    return (
      <AppShell nav={nav} title={t('account.title')}>
        <EmptyState
          body={configured ? t('auth.customerSignInIntro') : t('auth.notConfigured')}
          action={
            <Link to="/auth/customer" className="btn-primary">
              {t('auth.continueWithGoogle')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim(),
        emailNotificationsOptIn: optIn,
      });
      push(t('account.saved'), 'success');
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      nav={nav}
      title={t('account.title')}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/merchant" className="btn-secondary">
            {t('nav.manageBusiness')}
          </Link>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void signOut().then(() => navigate('/'))}
          >
            {t('nav.signOut')}
          </button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4 p-4">
          <h2 className="text-base font-semibold text-ink">{t('account.profile')}</h2>
          <p className="text-sm text-ink-muted">{t('auth.signedInAs', { email: profile?.email ?? '' })}</p>

          <Field label={t('checkout.name')}>
            {({ id }) => <TextInput id={id} value={fullName} onChange={(event) => setFullName(event.target.value)} />}
          </Field>

          <Field label={t('account.phone')}>
            {({ id }) => (
              <TextInput
                id={id}
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300"
              checked={optIn}
              onChange={(event) => setOptIn(event.target.checked)}
            />
            <span>
              {t('account.emailUpdates')}
              <span className="block text-xs text-ink-muted">{t('account.emailUpdatesHint')}</span>
            </span>
          </label>

          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">{t('account.recentStores')}</h2>
          <p className="text-sm text-ink-muted">{t('account.recentNote')}</p>

          {recent.loading ? <LoadingState /> : null}
          {recent.error ? <ErrorState message={recent.error.message} onRetry={recent.reload} /> : null}
          {!recent.loading && (recent.data?.businesses.length ?? 0) === 0 ? (
            <EmptyState body={t('state.emptyBusinesses')} />
          ) : null}

          {recent.data && recent.data.businesses.length > 0 ? (
            <ul className="space-y-3">
              {recent.data.businesses.map((business) => (
                <li key={business.id}>
                  <BusinessCard business={business} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
