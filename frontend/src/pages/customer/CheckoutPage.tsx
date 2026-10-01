import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { useFeatures } from '../../providers/FeaturesProvider';
import { useCart } from '../../providers/CartProvider';
import { useToast } from '../../providers/ToastProvider';
import { AppShell } from '../../components/AppShell';
import { EmptyState, ErrorState, Field, LoadingState, TextArea, TextInput } from '../../components/ui';
import type { Order, Quote } from '../../lib/types';

/**
 * Order confirmation. The customer must sign in with Google, review the
 * server-calculated total and explicitly confirm before anything is created.
 */
export function CheckoutPage() {
  const { t, money } = useI18n();
  const { signedIn, isGoogleUser, profile, configured } = useAuth();
  const { authConfigured } = useFeatures();
  const cart = useCart();
  const { push } = useToast();
  const navigate = useNavigate();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const [name, setName] = useState(profile?.fullName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [optInEmail, setOptInEmail] = useState(profile?.emailNotificationsOptIn ?? false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ order: Order; businessName: string; note: string } | null>(null);

  const lines = cart.lines;
  const businessId = cart.businessId;

  useEffect(() => {
    if (profile?.fullName && !name) setName(profile.fullName);
    if (profile?.phone && !phone) setPhone(profile.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (!businessId || lines.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.orders
      .quote(
        businessId,
        lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      )
      .then((result) => {
        if (cancelled) return;
        setQuote(result.quote);
        // Pick a fulfilment option the shop actually offers.
        setFulfillment(result.quote.business.pickupEnabled ? 'PICKUP' : 'DELIVERY');
      })
      .catch((problem: unknown) => {
        if (!cancelled) setLoadError(problem instanceof Error ? problem : new Error(t('common.somethingWentWrong')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, lines, t]);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/cart', label: t('cart.title'), badge: cart.count },
      { to: '/orders', label: t('nav.orders') },
      { to: '/account', label: t('nav.account') },
    ],
    [t, cart.count],
  );

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('common.required');
    if (!/^[0-9+\-\s()]{6,20}$/.test(phone.trim())) next.phone = t('checkout.phoneHint');
    if (fulfillment === 'DELIVERY' && address.trim().length < 10) next.address = t('checkout.addressHint');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!businessId || !validate()) return;
    setSubmitting(true);
    try {
      const result = await api.orders.create({
        businessId,
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        fulfillment,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        ...(fulfillment === 'DELIVERY' ? { deliveryAddress: address.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        confirm: true,
      });

      if (optInEmail !== profile?.emailNotificationsOptIn) {
        // Preference is saved, but the order already exists and must not be lost.
        await api.account.update({ emailNotificationsOptIn: optInEmail }).catch(() => undefined);
      }

      cart.clear();
      setCreated({ order: result.order, businessName: result.business.name, note: result.notifications.note });
      push(t('checkout.success', { business: result.business.name }), 'success');
    } catch (problem) {
      if (problem instanceof ApiError) {
        push(problem.message, 'error');
        if (problem.needsGoogleSignIn) navigate('/auth/customer');
      } else {
        push(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <AppShell nav={nav} title={t('checkout.success', { business: created.businessName })}>
        <div className="card mx-auto max-w-lg p-6 text-center">
          <p className="text-lg font-semibold text-ink">{created.order.orderCode}</p>
          <p className="mt-1 text-sm text-ink-muted">{t('checkout.successNote')}</p>
          <p className="mt-3 text-sm text-ink-muted">{created.note}</p>
          <p className="mt-2 text-xs text-ink-soft">{t('checkout.noPayment')}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to={`/orders/${created.order.id}`} className="btn-primary">
              {t('checkout.viewOrder')}
            </Link>
            <Link to="/explore" className="btn-secondary">
              {t('explore.title')}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (lines.length === 0) {
    return (
      <AppShell nav={nav} title={t('checkout.title')}>
        <EmptyState
          body={t('cart.empty')}
          action={
            <Link to="/explore" className="btn-primary">
              {t('explore.title')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell nav={nav} title={t('checkout.title')}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {!signedIn || !isGoogleUser ? (
            <div className="card border-amber-200 bg-amber-50 p-4" role="alert">
              <p className="text-sm font-semibold text-amber-900">{t('checkout.signInRequired')}</p>
              {!authConfigured || !configured ? (
                <p className="mt-1 text-sm text-amber-900">{t('auth.googleNotConfigured')}</p>
              ) : null}
              <Link to="/auth/customer" className="btn-primary mt-3">
                {t('auth.continueWithGoogle')}
              </Link>
            </div>
          ) : null}

          <section className="card p-4">
            <h2 className="text-base font-semibold text-ink">{t('checkout.fulfillment')}</h2>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t('checkout.fulfillment')}>
              <button
                type="button"
                role="radio"
                aria-checked={fulfillment === 'PICKUP'}
                disabled={!quote?.business.pickupEnabled}
                className={fulfillment === 'PICKUP' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setFulfillment('PICKUP')}
              >
                {t('checkout.pickup')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={fulfillment === 'DELIVERY'}
                disabled={!quote?.business.deliveryEnabled}
                className={fulfillment === 'DELIVERY' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setFulfillment('DELIVERY')}
              >
                {t('checkout.delivery')}
              </button>
            </div>
            {quote && !quote.business.deliveryEnabled ? (
              <p className="mt-2 text-xs text-ink-muted">{t('checkout.deliveryUnavailable')}</p>
            ) : null}
            {quote && !quote.business.pickupEnabled ? (
              <p className="mt-2 text-xs text-ink-muted">{t('checkout.pickupUnavailable')}</p>
            ) : null}
          </section>

          <section className="card space-y-4 p-4">
            <Field label={t('checkout.name')} error={errors.name} required>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="name"
                  invalid={invalid}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>

            <Field label={t('checkout.phone')} hint={t('checkout.phoneHint')} error={errors.phone} required>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type="tel"
                  inputMode="tel"
                  aria-describedby={describedBy}
                  autoComplete="tel"
                  invalid={invalid}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              )}
            </Field>

            <div>
              <p className="field-label">{t('checkout.email')}</p>
              <p className="text-sm text-ink-muted">{profile?.email ?? t('auth.signedInAs', { email: '' })}</p>
            </div>

            {fulfillment === 'DELIVERY' ? (
              <Field label={t('checkout.address')} hint={t('checkout.addressHint')} error={errors.address} required>
                {({ id, describedBy, invalid }) => (
                  <TextArea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                )}
              </Field>
            ) : null}

            <Field label={t('checkout.notes')} hint={t('checkout.notesHint')}>
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </Field>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={optInEmail}
                onChange={(event) => setOptInEmail(event.target.checked)}
              />
              <span>{t('checkout.optInEmail')}</span>
            </label>
          </section>
        </div>

        <aside className="card h-fit p-4 lg:sticky lg:top-28">
          <h2 className="text-base font-semibold text-ink">{t('cart.title')}</h2>

          {loading ? <LoadingState /> : null}
          {loadError ? <ErrorState message={loadError.message} /> : null}

          {quote ? (
            <>
              <ul className="mt-3 space-y-2 text-sm">
                {quote.lines.map((line) => (
                  <li key={line.productId} className="flex justify-between gap-3">
                    <span className="text-ink">
                      {line.name} × {line.quantity}
                    </span>
                    <span className="font-medium text-ink">{money(line.lineTotal)}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-base">
                <dt className="font-semibold text-ink">{t('common.total')}</dt>
                <dd className="font-bold text-ink">{money(quote.total)}</dd>
              </dl>

              {quote.issues.length > 0 ? (
                <ul className="mt-3 list-disc rounded-xl bg-amber-50 p-3 pl-7 text-sm text-amber-900" role="alert">
                  {quote.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-3 text-xs text-ink-soft">{t('checkout.noPayment')}</p>

              <button
                type="button"
                className="btn-primary mt-4 w-full py-3"
                disabled={submitting || !signedIn || !isGoogleUser || !quote.canSubmit}
                onClick={() => void submit()}
              >
                {submitting ? t('checkout.confirming') : t('checkout.confirm')}
              </button>

              {!signedIn || !isGoogleUser ? (
                <p className="mt-2 text-xs text-ink-muted">{t('checkout.signInRequired')}</p>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
