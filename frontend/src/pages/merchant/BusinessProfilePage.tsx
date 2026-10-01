import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useFeatures } from '../../providers/FeaturesProvider';
import { useToast } from '../../providers/ToastProvider';
import { MerchantGate } from '../../components/MerchantGate';
import { Field, SectionHeading, Select, TextArea, TextInput } from '../../components/ui';
import type { MerchantBusiness, PublicHour } from '../../lib/types';

const CATEGORIES = [
  'GROCERY_DAILY_ESSENTIALS',
  'FOOD_BEVERAGES',
  'FASHION_TEXTILES',
  'ELECTRONICS_APPLIANCES',
  'HEALTH_PERSONAL_CARE',
  'HOME_HARDWARE',
  'BOOKS_STATIONERY_GIFTS_OTHER',
];

const DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface HourDraft {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string;
  closeTime: string;
}

function toHourDrafts(hours: PublicHour[]): HourDraft[] {
  return DAY_KEYS.map((_, dayOfWeek) => {
    const existing = hours.find((hour) => hour.dayOfWeek === dayOfWeek);
    return {
      dayOfWeek,
      isClosed: existing?.isClosed ?? false,
      openTime: existing?.openTime ?? '09:00',
      closeTime: existing?.closeTime ?? '21:00',
    };
  });
}

export function BusinessProfilePage() {
  const { t } = useI18n();
  const { businessId = '' } = useParams();
  const { emailConfigured } = useFeatures();
  const { push } = useToast();

  return (
    <MerchantGate title={t('merchant.businessProfile')}>
      {({ business, reload }) => (
        <ProfileBody
          business={business}
          businessId={businessId || business.id}
          emailConfigured={emailConfigured}
          onSaved={reload}
          push={push}
          t={t}
        />
      )}
    </MerchantGate>
  );
}

function ProfileBody({
  business,
  businessId,
  emailConfigured,
  onSaved,
  push,
  t,
}: {
  business: MerchantBusiness;
  businessId: string;
  emailConfigured: boolean;
  onSaved: () => void;
  push: (message: string, tone?: 'success' | 'error' | 'info') => void;
  t: (key: never, vars?: Record<string, string | number>) => string;
}) {
  const [form, setForm] = useState({
    name: business.name,
    category: business.category,
    description: business.description ?? '',
    publicPhone: business.publicPhone ?? '',
    publicEmail: business.publicEmail ?? '',
    addressLine: business.address.line ?? '',
    city: business.address.city ?? '',
    state: business.address.state ?? '',
    pincode: business.address.pincode ?? '',
    latitude: business.address.latitude?.toString() ?? '',
    longitude: business.address.longitude?.toString() ?? '',
    pickupEnabled: business.pickupEnabled,
    deliveryEnabled: business.deliveryEnabled,
    deliveryNotes: business.deliveryNotes ?? '',
    paymentMethods: business.paymentMethods.join('\n'),
    returnPolicy: business.returnPolicy ?? '',
    assistantNotes: business.assistantNotes ?? '',
    emailNotificationsOptIn: business.emailNotificationsOptIn,
    emailNotificationsEmail: business.emailNotificationsEmail ?? '',
    isActive: business.isActive,
    isPublic: business.isPublic,
  });
  const [hours, setHours] = useState<HourDraft[]>(() => toHourDrafts(business.hours));
  const [faqs, setFaqs] = useState(() =>
    business.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHours(toHourDrafts(business.hours));
  }, [business.id, business.hours]);

  const save = async () => {
    setBusy(true);
    try {
      await api.merchant.updateBusiness(businessId, {
        ...form,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        paymentMethods: form.paymentMethods
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean),
        hours: hours.map((hour) => ({
          dayOfWeek: hour.dayOfWeek,
          isClosed: hour.isClosed,
          openTime: hour.isClosed ? null : hour.openTime,
          closeTime: hour.isClosed ? null : hour.closeTime,
        })),
        faqs: faqs.filter((faq) => faq.question.trim() && faq.answer.trim()),
      });
      push(t('merchant.saved' as never), 'success');
      onSaved();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong' as never), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-4">
        <SectionHeading title={t('merchant.publicDetails' as never)} />

        <Field label={t('merchant.businessName' as never)} required>
          {({ id }) => (
            <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('merchant.primaryCategory' as never)} required>
            {({ id }) => (
              <Select
                id={id}
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('merchant.publicPhone' as never)} hint={t('merchant.publicPhoneHint' as never)}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                type="tel"
                aria-describedby={describedBy}
                value={form.publicPhone}
                onChange={(event) => setForm({ ...form, publicPhone: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field label={t('merchant.addressLine' as never)}>
          {({ id }) => (
            <TextInput
              id={id}
              value={form.addressLine}
              onChange={(event) => setForm({ ...form, addressLine: event.target.value })}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('merchant.city' as never)}>
            {({ id }) => (
              <TextInput id={id} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            )}
          </Field>
          <Field label={t('merchant.state' as never)}>
            {({ id }) => (
              <TextInput id={id} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
            )}
          </Field>
          <Field label={t('merchant.pincode' as never)}>
            {({ id }) => (
              <TextInput
                id={id}
                inputMode="numeric"
                maxLength={6}
                value={form.pincode}
                onChange={(event) => setForm({ ...form, pincode: event.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('merchant.latitude' as never)} hint={t('merchant.locationPinHint' as never)}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                value={form.latitude}
                onChange={(event) => setForm({ ...form, latitude: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('merchant.longitude' as never)}>
            {({ id }) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={form.longitude}
                onChange={(event) => setForm({ ...form, longitude: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field label={t('business.about' as never)}>
          {({ id }) => (
            <TextArea
              id={id}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          )}
        </Field>
      </section>

      <section className="card space-y-3 p-4">
        <SectionHeading
          title={t('merchant.storeHours' as never)}
          action={
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={() => {
                const monday = hours.find((hour) => hour.dayOfWeek === 1);
                if (!monday) return;
                setHours((current) =>
                  current.map((hour) => ({
                    ...hour,
                    isClosed: monday.isClosed,
                    openTime: monday.openTime,
                    closeTime: monday.closeTime,
                  })),
                );
              }}
            >
              {t('merchant.copyMonday' as never)}
            </button>
          }
        />

        <ul className="space-y-2">
          {hours.map((hour) => (
            <li key={hour.dayOfWeek} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium text-ink">{DAY_KEYS[hour.dayOfWeek]}</span>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={hour.isClosed}
                  onChange={(event) =>
                    setHours((current) =>
                      current.map((entry) =>
                        entry.dayOfWeek === hour.dayOfWeek ? { ...entry, isClosed: event.target.checked } : entry,
                      ),
                    )
                  }
                />
                {t('merchant.closed' as never)}
              </label>
              <label className="sr-only" htmlFor={`open-${hour.dayOfWeek}`}>
                {t('merchant.opens' as never)}
              </label>
              <input
                id={`open-${hour.dayOfWeek}`}
                type="time"
                className="input w-32 py-1.5"
                disabled={hour.isClosed}
                value={hour.openTime}
                onChange={(event) =>
                  setHours((current) =>
                    current.map((entry) =>
                      entry.dayOfWeek === hour.dayOfWeek ? { ...entry, openTime: event.target.value } : entry,
                    ),
                  )
                }
              />
              <label className="sr-only" htmlFor={`close-${hour.dayOfWeek}`}>
                {t('merchant.closes' as never)}
              </label>
              <input
                id={`close-${hour.dayOfWeek}`}
                type="time"
                className="input w-32 py-1.5"
                disabled={hour.isClosed}
                value={hour.closeTime}
                onChange={(event) =>
                  setHours((current) =>
                    current.map((entry) =>
                      entry.dayOfWeek === hour.dayOfWeek ? { ...entry, closeTime: event.target.value } : entry,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-4 p-4">
        <SectionHeading title={t('business.options' as never)} />

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={form.pickupEnabled}
              onChange={(event) => setForm({ ...form, pickupEnabled: event.target.checked })}
            />
            {t('business.pickup' as never)}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={form.deliveryEnabled}
              onChange={(event) => setForm({ ...form, deliveryEnabled: event.target.checked })}
            />
            {t('business.delivery' as never)}
          </label>
        </div>

        <Field label={t('merchant.deliveryNotes' as never)}>
          {({ id }) => (
            <TextInput
              id={id}
              value={form.deliveryNotes}
              onChange={(event) => setForm({ ...form, deliveryNotes: event.target.value })}
            />
          )}
        </Field>

        <Field label={t('merchant.paymentMethods' as never)} hint={t('merchant.paymentMethodsHint' as never)}>
          {({ id, describedBy }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={form.paymentMethods}
              onChange={(event) => setForm({ ...form, paymentMethods: event.target.value })}
            />
          )}
        </Field>

        <Field label={t('merchant.returnPolicy' as never)}>
          {({ id }) => (
            <TextArea
              id={id}
              value={form.returnPolicy}
              onChange={(event) => setForm({ ...form, returnPolicy: event.target.value })}
            />
          )}
        </Field>
      </section>

      <section className="card space-y-3 p-4">
        <SectionHeading title={t('merchant.faqs' as never)} />
        <ul className="space-y-3">
          {faqs.map((faq, index) => (
            <li key={index} className="space-y-2 rounded-xl bg-slate-50 p-3">
              <Field label={t('merchant.faqQuestion' as never)}>
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={faq.question}
                    onChange={(event) =>
                      setFaqs((current) =>
                        current.map((entry, position) =>
                          position === index ? { ...entry, question: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={t('merchant.faqAnswer' as never)}>
                {({ id }) => (
                  <TextArea
                    id={id}
                    value={faq.answer}
                    onChange={(event) =>
                      setFaqs((current) =>
                        current.map((entry, position) =>
                          position === index ? { ...entry, answer: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                className="btn-danger px-3 py-1.5 text-xs"
                onClick={() => setFaqs((current) => current.filter((_, position) => position !== index))}
              >
                {t('common.remove' as never)}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setFaqs((current) => [...current, { question: '', answer: '' }])}
        >
          {t('merchant.addFaq' as never)}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <SectionHeading title={t('merchant.storeInfo' as never)} />
        <Field label={t('merchant.assistantNotes' as never)} hint={t('merchant.assistantNotesHint' as never)}>
          {({ id, describedBy }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={form.assistantNotes}
              onChange={(event) => setForm({ ...form, assistantNotes: event.target.value })}
            />
          )}
        </Field>
      </section>

      <section className="card space-y-3 p-4">
        <SectionHeading title={t('merchant.notifications' as never)} />
        {!emailConfigured ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('merchant.noEmailConfigured' as never)}</p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={form.emailNotificationsOptIn}
            onChange={(event) => setForm({ ...form, emailNotificationsOptIn: event.target.checked })}
          />
          {t('merchant.notifyNewOrders' as never)}
        </label>
        <Field label={t('merchant.notifyEmail' as never)} hint={t('merchant.notifyEmailHint' as never)}>
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              type="email"
              aria-describedby={describedBy}
              value={form.emailNotificationsEmail}
              onChange={(event) => setForm({ ...form, emailNotificationsEmail: event.target.value })}
            />
          )}
        </Field>
      </section>

      <section className="card space-y-3 p-4">
        <SectionHeading title={t('merchant.visibility' as never)} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          {t('merchant.isActive' as never)}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={form.isPublic}
            onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
          />
          {t('merchant.isPublic' as never)}
        </label>
      </section>

      <div className="sticky bottom-20 flex gap-2 lg:bottom-4">
        <button type="button" className="btn-primary flex-1 py-3" disabled={busy} onClick={() => void save()}>
          {busy ? t('common.saving' as never) : t('common.save' as never)}
        </button>
      </div>
    </div>
  );
}
