import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { useToast } from '../../providers/ToastProvider';
import { AppShell } from '../../components/AppShell';
import { Field, Select, TextInput } from '../../components/ui';

const CATEGORIES = [
  { value: 'GROCERY_DAILY_ESSENTIALS', label: 'Grocery & daily essentials' },
  { value: 'FOOD_BEVERAGES', label: 'Food & beverages' },
  { value: 'FASHION_TEXTILES', label: 'Fashion & textiles' },
  { value: 'ELECTRONICS_APPLIANCES', label: 'Electronics & appliances' },
  { value: 'HEALTH_PERSONAL_CARE', label: 'Health & personal care' },
  { value: 'HOME_HARDWARE', label: 'Home & hardware' },
  { value: 'BOOKS_STATIONERY_GIFTS_OTHER', label: 'Books, stationery, gifts & other/mixed retail' },
];

/**
 * Business setup kept separate from account creation. Only the essentials are
 * asked here; products, hours, policies and FAQs follow in the dashboard.
 * A map pin is optional - a typed address is enough.
 */
export function BusinessSetupPage() {
  const { t } = useI18n();
  const { refreshProfile } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    category: '',
    ownerName: '',
    addressLine: '',
    city: '',
    state: '',
    pincode: '',
    publicPhone: '',
    latitude: '',
    longitude: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'done' | 'denied' | 'unsupported'>('idle');

  /**
   * Optional convenience only. The address is always entered by hand, and a
   * location pin is never required to create a business. Denied permission and
   * unsupported browsers are both handled without blocking the form.
   */
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoState('unsupported');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        update('latitude', position.coords.latitude.toFixed(6));
        update('longitude', position.coords.longitude.toFixed(6));
        setGeoState('done');
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = t('common.required');
    if (!form.category) next.category = t('common.required');
    if (form.ownerName.trim().length < 2) next.ownerName = t('common.required');
    if (form.addressLine.trim().length < 5) next.addressLine = t('common.required');
    if (form.city.trim().length < 2) next.city = t('common.required');
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) next.pincode = t('common.required');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const result = await api.merchant.createBusiness({
        name: form.name.trim(),
        category: form.category,
        ownerName: form.ownerName.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        ...(form.state.trim() ? { state: form.state.trim() } : {}),
        ...(form.pincode ? { pincode: form.pincode } : {}),
        ...(form.publicPhone.trim() ? { publicPhone: form.publicPhone.trim() } : {}),
        ...(form.latitude && form.longitude
          ? { latitude: Number(form.latitude), longitude: Number(form.longitude) }
          : {}),
      });
      await refreshProfile();
      push(t('merchant.saved'), 'success');
      navigate(`/merchant/${result.business.id}/products`, { replace: true });
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      nav={[
        { to: '/merchant', label: t('nav.overview') },
        { to: '/merchant/setup', label: t('nav.business') },
      ]}
      title={t('merchant.setupTitle')}
      subtitle={t('merchant.setupIntro')}
    >
      <div className="card mx-auto max-w-2xl space-y-4 p-4">
        <Field label={t('merchant.businessName')} error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
            />
          )}
        </Field>

        <Field label={t('merchant.primaryCategory')} error={errors.category} required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.category}
              onChange={(event) => update('category', event.target.value)}
            >
              <option value="">{t('merchant.chooseCategory')}</option>
              {CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('merchant.ownerName')} error={errors.ownerName} required>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              autoComplete="name"
              invalid={invalid}
              value={form.ownerName}
              onChange={(event) => update('ownerName', event.target.value)}
            />
          )}
        </Field>

        <Field label={t('merchant.addressLine')} hint={t('merchant.addressHint')} error={errors.addressLine} required>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.addressLine}
              onChange={(event) => update('addressLine', event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('merchant.city')} error={errors.city} required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.city}
                onChange={(event) => update('city', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('merchant.state')}>
            {({ id }) => <TextInput id={id} value={form.state} onChange={(event) => update('state', event.target.value)} />}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('merchant.pincode')} error={errors.pincode}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                inputMode="numeric"
                maxLength={6}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.pincode}
                onChange={(event) => update('pincode', event.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Field label={t('merchant.publicPhone')} hint={t('merchant.publicPhoneHint')}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                type="tel"
                inputMode="tel"
                aria-describedby={describedBy}
                value={form.publicPhone}
                onChange={(event) => update('publicPhone', event.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-ink">{t('merchant.locationPin')}</legend>
          <p className="field-hint mb-2">{t('merchant.locationPinHint')}</p>

          <button
            type="button"
            className="btn-secondary mb-3"
            onClick={useMyLocation}
            disabled={geoState === 'locating'}
          >
            {geoState === 'locating' ? t('common.loading') : t('merchant.useMyLocation')}
          </button>

          {geoState === 'done' ? (
            <p className="mb-3 text-sm text-emerald-700" role="status">
              {t('merchant.locationCaptured')}
            </p>
          ) : null}
          {geoState === 'denied' ? (
            <p className="mb-3 text-sm text-amber-800" role="status">
              {t('merchant.locationDenied')}
            </p>
          ) : null}
          {geoState === 'unsupported' ? (
            <p className="mb-3 text-sm text-amber-800" role="status">
              {t('merchant.locationUnsupported')}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('merchant.latitude')}>
              {({ id }) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={form.latitude}
                  onChange={(event) => update('latitude', event.target.value)}
                />
              )}
            </Field>
            <Field label={t('merchant.longitude')}>
              {({ id }) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={form.longitude}
                  onChange={(event) => update('longitude', event.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <button type="button" className="btn-primary w-full py-3" disabled={busy} onClick={() => void submit()}>
          {busy ? t('common.saving') : t('merchant.createBusiness')}
        </button>
      </div>
    </AppShell>
  );
}
