export type LanguageCode = 'en' | 'bn' | 'hi';

export type Availability = 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNKNOWN';

export type OrderStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED';

export type OpenState = 'open' | 'closed' | 'unknown';

export interface PublicHour {
  dayOfWeek: number;
  day: string;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  note: string | null;
}

export interface PublicFaq {
  id: string;
  question: string;
  answer: string;
}

export interface PublicBusiness {
  id: string;
  name: string;
  slug: string;
  category: string;
  categoryLabel: string;
  description: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  address: {
    line: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  openState: OpenState;
  hours: PublicHour[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryNotes: string | null;
  paymentMethods: string[];
  returnPolicy: string | null;
  faqs: PublicFaq[];
  productCount?: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: string;
  currency: string;
  availability: Availability;
  availabilityLabel: string;
  aliases: string[];
  updatedAt?: string;
}

export interface MerchantProduct extends PublicProduct {
  isArchived: boolean;
  createdAt: string;
}

export interface MerchantBusiness extends PublicBusiness {
  ownerId: string;
  isActive: boolean;
  isPublic: boolean;
  assistantNotes: string | null;
  emailNotificationsOptIn: boolean;
  emailNotificationsEmail: string | null;
  createdAt: string;
  faqs: Array<PublicFaq & { sortOrder: number; isActive: boolean }>;
}

export interface OrderLine {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface StatusEvent {
  id: string;
  status: OrderStatus;
  statusLabel: string;
  note: string | null;
  createdAt: string;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  tags: string[];
  createdAt: string;
  source?: 'ORDER' | 'CONVERSATION';
}

export interface Order {
  id: string;
  orderCode: string;
  status: OrderStatus;
  statusLabel: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  businessId: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail?: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  subtotal: string;
  total: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: OrderLine[];
  statusHistory: StatusEvent[];
  canReview: boolean;
  review: Review | null;
  business?: { id: string; name: string; slug: string };
}

export interface QuoteLine extends OrderLine {
  availability: Availability;
  availabilityLabel: string;
  orderable: boolean;
  issue?: string;
}

export interface Quote {
  business: { id: string; name: string; slug: string; pickupEnabled: boolean; deliveryEnabled: boolean };
  lines: QuoteLine[];
  subtotal: string;
  total: string;
  currency: string;
  issues: string[];
  canSubmit: boolean;
}

export interface ConversationMessage {
  id: string;
  role: 'CUSTOMER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  language: string | null;
  source: 'TEXT' | 'VOICE';
  createdAt: string;
}

export interface AssistantProposal {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  availability: Availability;
  availabilityLabel: string;
  orderable: boolean;
  lineTotal: string;
}

export interface AssistantMeta {
  reply: string;
  language: LanguageCode;
  proposals: AssistantProposal[];
  available: boolean;
  notice: { code: string; message: string } | null;
}

export interface CategoryMeta {
  id: string;
  slug: string;
  label: string;
}

export interface MetaResponse {
  categories: CategoryMeta[];
  availability: Array<{ id: Availability; label: string }>;
  orderStatuses: Array<{ id: OrderStatus; label: string }>;
  reviewTags: Array<{ id: string; label: string }>;
  languages: Array<{ code: LanguageCode; label: string }>;
}

export interface FeatureFlags {
  database: boolean;
  supabaseAuth: boolean;
  assistant: boolean;
  speechToText: boolean;
  speechPlayback: boolean;
  email: boolean;
}

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  locale: LanguageCode;
  role: 'CUSTOMER' | 'BUSINESS_OWNER' | 'ADMIN';
  signInProvider: string | null;
  emailNotificationsOptIn: boolean;
}

export interface Overview {
  needsAttention: { newOrders: number; openConversations: number; total: number };
  inProgressOrders: number;
  completedOrders: number;
  topProducts: Array<{ name: string; quantitySold: number; revenue: string }>;
  rating: { average: number | null; count: number };
  recentReviews: Review[];
  productAvailability: Array<{ value: Availability; label: string; count: number }>;
  recentOrders: Array<{
    id: string;
    orderCode: string;
    status: OrderStatus;
    statusLabel: string;
    customerName: string;
    total: string;
    itemCount: number;
    createdAt: string;
  }>;
}

export interface MerchantConversation {
  id: string;
  businessId: string;
  status: 'OPEN' | 'RESOLVED';
  customerLocale: string;
  lastMessageAt: string;
  createdAt: string;
  isGuest: boolean;
  customerName: string | null;
  messages?: ConversationMessage[];
  feedback?: { rating: number; comment: string | null; createdAt: string } | null;
}

export interface ImportIssue {
  row: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ImportPreview {
  mode: 'preview';
  filename: string;
  missingColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Array<{
    name: string;
    price: string;
    availability: Availability;
    description: string | null;
    category: string | null;
    aliases: string[];
  }>;
  issues: ImportIssue[];
  canCommit: boolean;
}
