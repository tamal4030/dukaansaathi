import type {
  AssistantMeta,
  AuthUser,
  FeatureFlags,
  ImportPreview,
  MerchantBusiness,
  MerchantConversation,
  MerchantProduct,
  MetaResponse,
  Order,
  Overview,
  PublicBusiness,
  PublicProduct,
  Quote,
  Review,
  ConversationMessage,
  LanguageCode,
  OrderStatus,
  Availability,
} from './types';

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
const BASE = RAW_BASE === '' ? '/api' : RAW_BASE;

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }

  /** True when the server told us a required integration is not configured. */
  get isNotConfigured(): boolean {
    return this.code === 'NOT_CONFIGURED';
  }

  get needsGoogleSignIn(): boolean {
    return this.code === 'GOOGLE_SIGN_IN_REQUIRED';
  }
}

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter = async () => null;

/** Wired up by the auth provider so the API client never touches storage keys. */
export function setTokenGetter(getter: TokenGetter): void {
  tokenGetter = getter;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Return the raw response instead of JSON, used for spreadsheet downloads. */
  raw?: boolean;
  /** Server-issued token that authorises one guest conversation. */
  guestToken?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (!options.anonymous) {
    const token = await tokenGetter();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // Guests hold an unguessable server-issued token instead of a session.
  if (options.guestToken) headers['X-Guest-Token'] = options.guestToken;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.');
  }

  if (options.raw) {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ApiError(response.status, 'REQUEST_FAILED', text || 'Download failed.');
    }
    return (await response.blob()) as unknown as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'The request failed.',
      body?.error?.details,
    );
  }

  return payload as T;
}

async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  const headers: Record<string, string> = {};
  const token = await tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.');
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'The upload failed.',
      body?.error?.details,
    );
  }
  return payload as T;
}

export interface TranscribeResult {
  transcript: string;
  /** Raw locale from the provider, e.g. "bn-IN". */
  languageCode: string | null;
  /** Normalised to the app's LanguageCode, or null when unrecognised. */
  detectedLanguage: LanguageCode | null;
  /** Provider confidence when reported (saaras:v3); null otherwise. */
  languageProbability: number | null;
  /** The STT mode used. Must be "transcribe" for native-language output. */
  mode: string;
  /** The language the client asked for, or null for automatic detection. */
  requestedLanguage: LanguageCode | null;
  /** True when automatic detection was requested rather than a fixed language. */
  autoDetected: boolean;
}

async function uploadAudio(
  path: string,
  blob: Blob,
  language: LanguageCode | null,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');
  // Omitted entirely means "detect automatically" (Sarvam language_code=unknown).
  if (language) form.append('language', language);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.');
  }
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'The recording could not be transcribed.',
    );
  }
  return payload as TranscribeResult;
}

export const api = {
  health: {
    features: () => request<FeatureFlags>('/health/features', { anonymous: true }),
  },

  meta: () => request<MetaResponse>('/meta', { anonymous: true }),

  businesses: {
    list: (params: { search?: string; category?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.category) query.set('category', params.category);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<{ total: number; businesses: PublicBusiness[] }>(`/businesses${suffix}`, { anonymous: true });
    },
    recent: (ids: string[]) =>
      request<{ businesses: PublicBusiness[] }>(`/businesses/recent?ids=${encodeURIComponent(ids.join(','))}`, {
        anonymous: true,
      }),
    get: (idOrSlug: string) =>
      request<{
        business: PublicBusiness;
        rating: { average: number | null; count: number };
        reviews: Review[];
      }>(`/businesses/${encodeURIComponent(idOrSlug)}`, { anonymous: true }),
    products: (idOrSlug: string, params: { search?: string; category?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.category) query.set('category', params.category);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<{ total: number; products: PublicProduct[] }>(
        `/businesses/${encodeURIComponent(idOrSlug)}/products${suffix}`,
        { anonymous: true },
      );
    },
  },

  conversations: {
    start: (businessId: string, locale: LanguageCode) =>
      request<{
        conversation: { id: string; businessId: string; status: string; customerLocale: string };
        guestToken: string | null;
      }>('/conversations', { method: 'POST', body: { businessId, locale }, anonymous: true }),

    get: (id: string, guestToken: string | null) =>
      request<{
        conversation: { id: string; businessId: string; status: string };
        business: { id: string; name: string; slug: string };
        messages: ConversationMessage[];
      }>(`/conversations/${id}`, { anonymous: true, guestToken }),
  },

  messages: {
    send: (payload: {
      conversationId: string;
      guestToken: string | null;
      content: string;
      locale: LanguageCode;
      source: 'TEXT' | 'VOICE';
      cart: Array<{ productId: string | null; name: string; quantity: number; unitPrice: string; availability?: string }>;
    }) =>
      request<{
        messages: ConversationMessage[];
        assistant: AssistantMeta;
        business: { id: string; name: string; slug: string; openState: string };
      }>(`/conversations/${payload.conversationId}/messages`, {
        method: 'POST',
        body: { content: payload.content, locale: payload.locale, source: payload.source, cart: payload.cart },
        anonymous: true,
        guestToken: payload.guestToken,
      }),

    feedback: (conversationId: string, guestToken: string | null, body: { rating: number; comment?: string }) =>
      request<{ feedback: { id: string; rating: number } }>(`/conversations/${conversationId}/feedback`, {
        method: 'POST',
        body,
        anonymous: true,
        guestToken,
      }),
  },

  speech: {
    /**
     * Pass null for automatic language detection. The UI language must not be
     * sent here: a customer browsing in English may speak Bengali.
     */
    transcribe: (blob: Blob, language: LanguageCode | null = null) =>
      uploadAudio('/speech/transcribe', blob, language),
    speak: (text: string, language: LanguageCode) =>
      request<{ audioBase64: string; mimeType: string }>('/speech/speak', {
        method: 'POST',
        body: { text, language },
      }),
  },

  account: {
    profile: () => request<{ profile: AuthUser }>('/account/profile'),
    update: (body: Partial<Pick<AuthUser, 'fullName' | 'phone' | 'locale' | 'emailNotificationsOptIn'>>) =>
      request<{ profile: AuthUser }>('/account/profile', { method: 'PATCH', body }),
    recent: () => request<{ businesses: PublicBusiness[] }>('/account/recent'),
    recordRecent: (businessId: string) =>
      request<{ recent: { businessId: string } }>('/account/recent', { method: 'POST', body: { businessId } }),
  },

  orders: {
    quote: (businessId: string, items: Array<{ productId: string; quantity: number }>) =>
      request<{ quote: Quote }>('/customer/orders/quote', { method: 'POST', body: { businessId, items }, anonymous: true }),
    create: (body: {
      businessId: string;
      items: Array<{ productId: string; quantity: number }>;
      fulfillment: 'PICKUP' | 'DELIVERY';
      customerName?: string;
      customerPhone: string;
      deliveryAddress?: string;
      notes?: string;
      confirm: true;
    }) =>
      request<{
        order: Order;
        business: { id: string; name: string; slug: string };
        notifications: { businessEmail: string; note: string };
      }>('/customer/orders', { method: 'POST', body }),
    list: () => request<{ orders: Order[] }>('/customer/orders'),
    get: (orderId: string) =>
      request<{ order: Order; business: { id: string; name: string; slug: string; publicPhone: string | null } }>(
        `/customer/orders/${orderId}`,
      ),
    review: (orderId: string, body: { rating: number; comment?: string; tags?: string[] }) =>
      request<{ review: Review }>(`/customer/orders/${orderId}/review`, { method: 'POST', body }),

    /**
     * Merchant-side single order. The business id is required in the path so the
     * backend can re-check ownership rather than trusting the order id alone.
     */
    getForMerchant: (orderId: string, businessId: string) =>
      request<{ order: Order; nextStatuses: Array<{ id: OrderStatus; label: string }> }>(
        `/merchant/businesses/${businessId}/orders/${orderId}`,
      ),
  },

  merchant: {
    createBusiness: (body: {
      name: string;
      category: string;
      ownerName: string;
      addressLine: string;
      city: string;
      state?: string;
      pincode?: string;
      publicPhone?: string;
      latitude?: number | null;
      longitude?: number | null;
    }) => request<{ business: MerchantBusiness }>('/merchant/businesses', { method: 'POST', body }),

    listBusinesses: () => request<{ businesses: MerchantBusiness[] }>('/merchant/businesses'),

    getBusiness: (id: string) =>
      request<{ business: MerchantBusiness; role: string }>(`/merchant/businesses/${id}`),

    updateBusiness: (id: string, body: Record<string, unknown>) =>
      request<{ business: MerchantBusiness }>(`/merchant/businesses/${id}`, { method: 'PATCH', body }),

    overview: (id: string) => request<Overview>(`/merchant/businesses/${id}/overview`),

    orders: (id: string, status?: OrderStatus | 'ALL') =>
      request<{ orders: Order[]; counts: Array<{ status: OrderStatus; _count: { _all: number } }> }>(
        `/merchant/businesses/${id}/orders${status && status !== 'ALL' ? `?status=${status}` : ''}`,
      ),

    order: (businessId: string, orderId: string) =>
      request<{ order: Order; nextStatuses: Array<{ id: OrderStatus; label: string }> }>(
        `/merchant/businesses/${businessId}/orders/${orderId}`,
      ),

    updateOrderStatus: (businessId: string, orderId: string, status: OrderStatus, note?: string) =>
      request<{ order: Order; notifications: { customerEmail: string; note: string } }>(
        `/merchant/businesses/${businessId}/orders/${orderId}/status`,
        { method: 'PATCH', body: { status, note } },
      ),

    products: (id: string, params: { search?: string; includeArchived?: boolean } = {}) => {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.includeArchived) query.set('includeArchived', 'true');
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request<{ products: MerchantProduct[] }>(`/merchant/businesses/${id}/products${suffix}`);
    },

    createProduct: (
      id: string,
      body: { name: string; price: number; availability: Availability; description?: string | null; category?: string | null; aliases?: string[] },
    ) => request<{ product: MerchantProduct }>(`/merchant/businesses/${id}/products`, { method: 'POST', body }),

    updateProduct: (id: string, productId: string, body: Record<string, unknown>) =>
      request<{ product: MerchantProduct }>(`/merchant/businesses/${id}/products/${productId}`, {
        method: 'PATCH',
        body,
      }),

    archiveProduct: (id: string, productId: string) =>
      request<{ product: MerchantProduct }>(`/merchant/businesses/${id}/products/${productId}`, { method: 'DELETE' }),

    previewImport: (id: string, file: File) =>
      upload<ImportPreview>(`/merchant/businesses/${id}/products/import`, file),

    commitImport: (id: string, file: File, excludeNames: string[] = []) =>
      upload<{ saved: boolean; created: number; updated: number; excluded: number; warnings: unknown[] }>(
        `/merchant/businesses/${id}/products/import?mode=commit`,
        file,
        excludeNames.length ? { excludeNames: JSON.stringify(excludeNames) } : {},
      ),

    downloadUrl: (id: string, kind: 'template' | 'export', format: 'xlsx' | 'csv') =>
      `${BASE}/merchant/businesses/${id}/products/${kind}?format=${format}`,

    reviews: (id: string) =>
      request<{
        rating: { average: number | null; count: number };
        reviews: Review[];
        conversationFeedback: Review[];
      }>(`/merchant/businesses/${id}/reviews`),
  },

  merchantConversations: {
    list: (businessId: string, status?: 'OPEN' | 'RESOLVED') =>
      request<{ conversations: MerchantConversation[] }>(
        `/conversations/business/${businessId}${status ? `?status=${status}` : ''}`,
      ),
    get: (businessId: string, conversationId: string) =>
      request<{ conversation: MerchantConversation }>(`/conversations/business/${businessId}/${conversationId}`),
    setStatus: (businessId: string, conversationId: string, status: 'OPEN' | 'RESOLVED') =>
      request<{ conversation: { id: string; status: string } }>(`/conversations/business/${businessId}/${conversationId}`, {
        method: 'PATCH',
        body: { status },
      }),
  },
};

/**
 * Authenticated downloads must send the bearer token, so a plain <a href> is
 * not enough: fetch the blob and hand it to the browser.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = await tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'The file could not be downloaded.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
