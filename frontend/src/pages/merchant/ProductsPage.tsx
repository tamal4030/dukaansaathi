import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, downloadFile } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../providers/ToastProvider';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, EmptyState, ErrorState, Field, LoadingState, SectionHeading, Select, TextArea, TextInput } from '../../components/ui';
import { availabilityTone } from '../../lib/format';
import type { Availability, ImportIssue, ImportPreview, MerchantProduct } from '../../lib/types';

const AVAILABILITY_VALUES: Availability[] = ['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN'];

interface ProductForm {
  name: string;
  price: string;
  availability: Availability;
  description: string;
  category: string;
  aliases: string;
}

const EMPTY_FORM: ProductForm = {
  name: '',
  price: '',
  availability: 'UNKNOWN',
  description: '',
  category: '',
  aliases: '',
};

export function MerchantProductsPage() {
  const { t } = useI18n();
  const { businessId = '' } = useParams();
  const { push } = useToast();

  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const state = useAsync(() => api.merchant.products(businessId, { search, includeArchived }), [businessId, search, includeArchived]);

  const [editing, setEditing] = useState<MerchantProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  /** Product names the merchant deselected in the preview. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement | null>(null);

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const openEdit = (product: MerchantProduct) => {
    setEditing(product);
    setCreating(false);
    setForm({
      name: product.name,
      price: product.price,
      availability: product.availability,
      description: product.description ?? '',
      category: product.category ?? '',
      aliases: product.aliases.join(', '),
    });
  };

  const saveProduct = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price),
        availability: form.availability,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        aliases: form.aliases
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean),
      };
      if (editing) {
        await api.merchant.updateProduct(businessId, editing.id, payload);
      } else {
        await api.merchant.createProduct(businessId, payload);
      }
      push(t('merchant.saved'), 'success');
      setEditing(null);
      setCreating(false);
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeAvailability = async (product: MerchantProduct, availability: Availability) => {
    try {
      await api.merchant.updateProduct(businessId, product.id, { availability });
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    }
  };

  const archive = async (product: MerchantProduct) => {
    try {
      await api.merchant.archiveProduct(businessId, product.id);
      push(t('merchant.productArchived'), 'success');
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    }
  };

  const restore = async (product: MerchantProduct) => {
    try {
      await api.merchant.updateProduct(businessId, product.id, { isArchived: false });
      push(t('merchant.productRestored'), 'success');
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    }
  };

  const runPreview = async (file: File) => {
    setImportBusy(true);
    setPreview(null);
    setImportFile(file);
    setExcluded(new Set());
    try {
      const result = await api.merchant.previewImport(businessId, file);
      setPreview(result);
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const commitImport = async () => {
    if (!importFile) return;
    setImportBusy(true);
    try {
      const result = await api.merchant.commitImport(businessId, importFile, [...excluded]);
      push(
        result.excluded > 0
          ? t('merchant.importSavedSkipped', {
              created: result.created,
              updated: result.updated,
              skipped: result.excluded,
            })
          : t('merchant.importSaved', { created: result.created, updated: result.updated }),
        'success',
      );
      setPreview(null);
      setImportFile(null);
      setExcluded(new Set());
      if (fileInput.current) fileInput.current.value = '';
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const errors = (preview?.issues ?? []).filter((issue: ImportIssue) => issue.severity === 'error');
  const warnings = (preview?.issues ?? []).filter((issue: ImportIssue) => issue.severity === 'warning');
  const selectedCount = (preview?.rows ?? []).filter((row) => !excluded.has(row.name)).length;

  return (
    <MerchantGate
      title={t('merchant.products')}
      actions={
        <button type="button" className="btn-primary" onClick={openCreate}>
          {t('merchant.addProduct')}
        </button>
      }
    >
      {() => (
        <div className="space-y-5">
          {(creating || editing) ? (
            <section className="card space-y-4 p-4">
              <SectionHeading title={editing ? t('merchant.editProduct') : t('merchant.addProduct')} />

              <Field label={t('merchant.productName')} required>
                {({ id, invalid }) => (
                  <TextInput
                    id={id}
                    invalid={invalid}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('merchant.productPrice')} required>
                  {({ id, invalid }) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      invalid={invalid}
                      value={form.price}
                      onChange={(event) => setForm({ ...form, price: event.target.value })}
                    />
                  )}
                </Field>

                <Field label={t('merchant.productAvailability')} hint={t('merchant.availabilityUnknownHint')} required>
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={form.availability}
                      onChange={(event) => setForm({ ...form, availability: event.target.value as Availability })}
                    >
                      <option value="AVAILABLE">{t('merchant.availabilityAvailable')}</option>
                      <option value="OUT_OF_STOCK">{t('merchant.availabilityOutOfStock')}</option>
                      <option value="UNKNOWN">{t('merchant.availabilityUnknown')}</option>
                    </Select>
                  )}
                </Field>
              </div>

              <Field label={t('merchant.productCategory')}>
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                  />
                )}
              </Field>

              <Field label={t('merchant.productAliases')} hint={t('merchant.productAliasesHint')}>
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={form.aliases}
                    onChange={(event) => setForm({ ...form, aliases: event.target.value })}
                  />
                )}
              </Field>

              <Field label={t('merchant.productDescription')}>
                {({ id }) => (
                  <TextArea
                    id={id}
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                )}
              </Field>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || form.name.trim().length === 0 || form.price === ''}
                  onClick={() => void saveProduct()}
                >
                  {busy ? t('common.saving') : t('common.save')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </section>
          ) : null}

          <section className="card space-y-4 p-4">
            <SectionHeading title={t('merchant.importExport')} hint={t('merchant.importIntro')} />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void downloadFile(api.merchant.downloadUrl(businessId, 'template', 'xlsx'), 'dukaansaathi-product-template.xlsx')
                }
              >
                {t('merchant.downloadTemplate')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void downloadFile(api.merchant.downloadUrl(businessId, 'template', 'csv'), 'dukaansaathi-product-template.csv')
                }
              >
                {t('merchant.downloadTemplateCsv')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void downloadFile(api.merchant.downloadUrl(businessId, 'export', 'xlsx'), 'dukaansaathi-products.xlsx')
                }
              >
                {t('merchant.exportProducts')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void downloadFile(api.merchant.downloadUrl(businessId, 'export', 'csv'), 'dukaansaathi-products.csv')
                }
              >
                {t('merchant.exportCsv')}
              </button>
            </div>

            <Field label={t('merchant.chooseFile')} hint={t('merchant.previewIntro')}>
              {({ id, describedBy }) => (
                <input
                  id={id}
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.csv"
                  aria-describedby={describedBy}
                  className="input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void runPreview(file);
                  }}
                />
              )}
            </Field>

            {importBusy ? <LoadingState /> : null}

            {preview ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={preview.validRows > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                    {t('merchant.rowsValid', { count: preview.validRows })}
                  </Badge>
                  {preview.invalidRows > 0 ? (
                    <Badge tone="bg-red-50 text-red-700">{t('merchant.rowsInvalid', { count: preview.invalidRows })}</Badge>
                  ) : null}
                </div>

                {preview.missingColumns.length > 0 ? (
                  <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                    {preview.missingColumns.join(', ')}
                  </p>
                ) : null}

                {errors.length > 0 ? (
                  <div className="rounded-xl bg-red-50 p-3" role="alert">
                    <p className="text-sm font-semibold text-red-800">{t('merchant.rowErrors')}</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
                      {errors.slice(0, 20).map((issue) => (
                        <li key={`${issue.row}-${issue.column}-${issue.message}`}>
                          {t('common.row', { row: issue.row })} · {issue.column}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {warnings.length > 0 ? (
                  <div className="rounded-xl bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900">{t('merchant.rowWarnings')}</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
                      {warnings.slice(0, 10).map((issue) => (
                        <li key={`${issue.row}-${issue.message}`}>
                          {t('common.row', { row: issue.row })}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <p className="field-label">{t('merchant.rowPreview')}</p>
                    <p className="field-hint mb-2">{t('merchant.rowPreviewHint')}</p>
                    <table className="w-full min-w-[680px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase text-ink-soft">
                          <th className="py-2 pr-2">{t('merchant.includeRow')}</th>
                          <th className="py-2">{t('common.name')}</th>
                          <th className="py-2">{t('common.price')}</th>
                          <th className="py-2">{t('common.status')}</th>
                          <th className="py-2">{t('common.category')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 200).map((row, index) => {
                          const isExcluded = excluded.has(row.name);
                          return (
                            <tr
                              key={`${row.name}-${index}`}
                              className={`border-b border-slate-100 ${isExcluded ? 'opacity-50' : ''}`}
                            >
                              <td className="py-2 pr-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={!isExcluded}
                                  aria-label={`${t('merchant.includeRow')}: ${row.name}`}
                                  onChange={() =>
                                    setExcluded((current) => {
                                      const next = new Set(current);
                                      if (next.has(row.name)) next.delete(row.name);
                                      else next.add(row.name);
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td className="py-2 text-ink">{row.name}</td>
                              <td className="py-2 text-ink-muted">{row.price}</td>
                              <td className="py-2">
                                <Badge tone={availabilityTone(row.availability)}>
                                  {row.availability === 'AVAILABLE'
                                    ? t('merchant.availabilityAvailable')
                                    : row.availability === 'OUT_OF_STOCK'
                                      ? t('merchant.availabilityOutOfStock')
                                      : t('merchant.availabilityUnknown')}
                                </Badge>
                              </td>
                              <td className="py-2 text-ink-muted">{row.category ?? ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!preview.canCommit || importBusy || selectedCount === 0}
                    onClick={() => void commitImport()}
                  >
                    {t('merchant.confirmImport', { count: selectedCount })}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setPreview(null);
                      setImportFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
                {!preview.canCommit ? (
                  <p className="text-sm text-ink-muted">{t('merchant.importNothingSaved')}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <SectionHeading
              title={t('merchant.products')}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    className="input w-48"
                    placeholder={t('common.search')}
                    aria-label={t('common.search')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={includeArchived}
                      onChange={(event) => setIncludeArchived(event.target.checked)}
                    />
                    {t('merchant.showArchived')}
                  </label>
                </div>
              }
            />

            {state.loading ? <LoadingState /> : null}
            {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}
            {!state.loading && (state.data?.products.length ?? 0) === 0 ? (
              <EmptyState body={t('state.emptyProducts')} />
            ) : null}

            {state.data && state.data.products.length > 0 ? (
              <ul className="space-y-2">
                {state.data.products.map((product) => (
                  <li key={product.id} className="card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[180px] flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {product.name}
                          {product.isArchived ? (
                            <span className="ml-2 chip bg-slate-200 text-slate-700">{t('merchant.archived')}</span>
                          ) : null}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {product.price} {product.category ? `· ${product.category}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`avail-${product.id}`}>
                          {t('merchant.productAvailability')}
                        </label>
                        <select
                          id={`avail-${product.id}`}
                          className="input w-auto py-1.5 text-sm"
                          value={product.availability}
                          onChange={(event) => void changeAvailability(product, event.target.value as Availability)}
                        >
                          <option value="AVAILABLE">{t('merchant.availabilityAvailable')}</option>
                          <option value="OUT_OF_STOCK">{t('merchant.availabilityOutOfStock')}</option>
                          <option value="UNKNOWN">{t('merchant.availabilityUnknown')}</option>
                        </select>
                        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => openEdit(product)}>
                          {t('common.edit')}
                        </button>
                        {product.isArchived ? (
                          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void restore(product)}>
                            {t('common.restore')}
                          </button>
                        ) : (
                          <button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={() => void archive(product)}>
                            {t('common.archive')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      )}
    </MerchantGate>
  );
}

export const availabilityValues = AVAILABILITY_VALUES;
