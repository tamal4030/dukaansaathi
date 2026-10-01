/**
 * Small in-memory Prisma double used by the API tests.
 *
 * Why: the test environment has no PostgreSQL server, and the production
 * database is managed Supabase PostgreSQL (never SQLite/JSON). This double
 * implements the subset of the Prisma query API the routes use so that
 * authorization, validation, totals and status logic can still be tested
 * end-to-end through the Express app. It is a test helper only - the
 * application always talks to PostgreSQL.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;

/**
 * Prisma returns `Prisma.Decimal` (not a string) for Decimal columns. The
 * double must do the same or code that calls `.mul()` on a price breaks only
 * in tests - exactly the kind of divergence a double must not introduce.
 */
const DECIMAL_FIELDS: Record<string, string[]> = {
  product: ['price'],
  order: ['subtotal', 'total'],
  orderItem: ['unitPriceSnapshot', 'lineTotal'],
};

function coerceDecimals(model: string, row: Row): Row {
  for (const field of DECIMAL_FIELDS[model] ?? []) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    if (!(value instanceof Prisma.Decimal)) row[field] = new Prisma.Decimal(value);
  }
  return row;
}

interface Relation {
  model: string;
  /** Foreign key on the related model that points back, or 'id' for a 1:1 parent. */
  foreignKey: string;
  many: boolean;
}

export const RELATIONS: Record<string, Record<string, Relation>> = {
  userProfile: {
    businesses: { model: 'businessMember', foreignKey: 'userId', many: true },
    ownedBusinesses: { model: 'business', foreignKey: 'ownerId', many: true },
    orders: { model: 'order', foreignKey: 'customerId', many: true },
    reviews: { model: 'orderReview', foreignKey: 'customerId', many: true },
    conversations: { model: 'conversation', foreignKey: 'userId', many: true },
    recentBusiness: { model: 'recentBusiness', foreignKey: 'userId', many: true },
  },
  businessMember: {
    business: { model: 'business', foreignKey: 'id', many: false },
    user: { model: 'userProfile', foreignKey: 'id', many: false },
  },
  business: {
    owner: { model: 'userProfile', foreignKey: 'id', many: false },
    hours: { model: 'businessHour', foreignKey: 'businessId', many: true },
    faqs: { model: 'businessFaq', foreignKey: 'businessId', many: true },
    products: { model: 'product', foreignKey: 'businessId', many: true },
    conversations: { model: 'conversation', foreignKey: 'businessId', many: true },
    orders: { model: 'order', foreignKey: 'businessId', many: true },
    reviews: { model: 'orderReview', foreignKey: 'businessId', many: true },
    recentVisits: { model: 'recentBusiness', foreignKey: 'businessId', many: true },
  },
  businessHour: { business: { model: 'business', foreignKey: 'id', many: false } },
  businessFaq: { business: { model: 'business', foreignKey: 'id', many: false } },
  product: {
    business: { model: 'business', foreignKey: 'id', many: false },
    orderItem: { model: 'orderItem', foreignKey: 'productId', many: true },
  },
  recentBusiness: {
    user: { model: 'userProfile', foreignKey: 'id', many: false },
    business: { model: 'business', foreignKey: 'id', many: false },
  },
  conversation: {
    business: { model: 'business', foreignKey: 'id', many: false },
    user: { model: 'userProfile', foreignKey: 'id', many: false },
    messages: { model: 'message', foreignKey: 'conversationId', many: true },
    feedback: { model: 'conversationFeedback', foreignKey: 'conversationId', many: false },
  },
  message: { conversation: { model: 'conversation', foreignKey: 'id', many: false } },
  conversationFeedback: { conversation: { model: 'conversation', foreignKey: 'id', many: false } },
  order: {
    business: { model: 'business', foreignKey: 'id', many: false },
    customer: { model: 'userProfile', foreignKey: 'id', many: false },
    items: { model: 'orderItem', foreignKey: 'orderId', many: true },
    statusEvents: { model: 'orderStatusEvent', foreignKey: 'orderId', many: true },
    review: { model: 'orderReview', foreignKey: 'orderId', many: false },
    notifications: { model: 'notificationLog', foreignKey: 'orderId', many: true },
  },
  orderItem: {
    order: { model: 'order', foreignKey: 'id', many: false },
    product: { model: 'product', foreignKey: 'id', many: false },
  },
  orderStatusEvent: { order: { model: 'order', foreignKey: 'id', many: false } },
  orderReview: {
    order: { model: 'order', foreignKey: 'id', many: false },
    business: { model: 'business', foreignKey: 'id', many: false },
    customer: { model: 'userProfile', foreignKey: 'id', many: false },
  },
  notificationLog: { order: { model: 'order', foreignKey: 'id', many: false } },
};

const UNIQUE_KEYS: Record<string, string[][]> = {
  userProfile: [['authUserId'], ['id']],
  business: [['slug'], ['id']],
  businessMember: [['businessId', 'userId'], ['id']],
  businessHour: [['businessId', 'dayOfWeek'], ['id']],
  businessFaq: [['id']],
  product: [['id']],
  recentBusiness: [['userId', 'businessId'], ['id']],
  conversation: [['guestToken'], ['id']],
  message: [['id']],
  conversationFeedback: [['conversationId'], ['id']],
  order: [['orderCode'], ['id']],
  orderItem: [['id']],
  orderStatusEvent: [['id']],
  orderReview: [['orderId'], ['id']],
  notificationLog: [['id']],
};

const DEFAULTS: Record<string, () => Row> = {
  userProfile: () => ({
    role: 'CUSTOMER',
    locale: 'en',
    emailNotificationsOptIn: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  business: () => ({
    pickupEnabled: true,
    deliveryEnabled: false,
    paymentMethods: [],
    searchText: '',
    isActive: true,
    isPublic: true,
    emailNotificationsOptIn: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  product: () => ({
    currency: 'INR',
    availability: 'UNKNOWN',
    aliases: [],
    searchText: '',
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  order: () => ({ status: 'NEW', currency: 'INR', createdAt: new Date(), updatedAt: new Date() }),
  orderItem: () => ({ quantity: 1, createdAt: new Date() }),
  orderStatusEvent: () => ({ createdAt: new Date() }),
  orderReview: () => ({ tags: [], createdAt: new Date() }),
  conversation: () => ({ status: 'OPEN', customerLocale: 'en', lastMessageAt: new Date(), createdAt: new Date(), updatedAt: new Date() }),
  message: () => ({ source: 'TEXT', createdAt: new Date() }),
  businessHour: () => ({ isClosed: false }),
  businessFaq: () => ({ sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() }),
  businessMember: () => ({ role: 'OWNER', createdAt: new Date() }),
  recentBusiness: () => ({ lastAccessedAt: new Date() }),
  conversationFeedback: () => ({ createdAt: new Date() }),
  notificationLog: () => ({ provider: 'resend', createdAt: new Date() }),
};

/**
 * Prisma treats `undefined` as "leave this field unchanged". The double must do
 * the same, otherwise an upsert that only sends some fields would wipe others.
 */
function stripUndefined<T extends Row>(data: T): T {
  const output: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) output[key] = value;
  }
  return output as T;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'object' && typeof b === 'object' && 'toFixed' in (a as object) && 'toFixed' in (b as object)) {
    return String(a) === String(b);
  }
  return String(a) === String(b);
}

const OPERATOR_KEYS = ['equals', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gte', 'lte', 'gt', 'lt', 'has', 'hasEvery', 'hasSome', 'not', 'mode'];

export class FakePrisma {
  tables: Record<string, Row[]> = {};
  private sequence = 0;

  constructor(private readonly tablesToCreate: string[] = Object.keys(RELATIONS)) {
    for (const table of tablesToCreate) this.tables[table] = [];
  }

  private rows(model: string): Row[] {
    if (!this.tables[model]) this.tables[model] = [];
    return this.tables[model];
  }

  seed(model: string, rows: Row[]): Row[] {
    const created = rows.map((row) => this.applyDefaults(model, row));
    this.rows(model).push(...created);
    return created;
  }

  private applyDefaults(model: string, input: Row): Row {
    const defaults = DEFAULTS[model]?.() ?? {};
    const row: Row = { id: input.id ?? randomUUID(), ...defaults, ...input };
    return coerceDecimals(model, row);
  }

  private nextOrderCode(): string {
    this.sequence += 1;
    return `DS-TEST-${String(this.sequence).padStart(4, '0')}`;
  }

  // ---------------------------------------------------------------- matching

  private relatedRows(model: string, row: Row, field: string): Row[] {
    const relation = RELATIONS[model]?.[field];
    if (!relation) throw new Error(`FakePrisma: no relation ${model}.${field}`);
    const target = this.rows(relation.model);
    if (relation.foreignKey === 'id') {
      return target.filter((candidate) => looseEquals(candidate.id, row[`${field}Id`] ?? row[field]));
    }
    return target.filter((candidate) => looseEquals(candidate[relation.foreignKey], row.id));
  }

  private matches(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    for (const [key, condition] of Object.entries(where)) {
      if (condition === undefined) continue;
      if (key === 'OR') {
        if (!(condition as Row[]).some((entry) => this.matches(model, row, entry))) return false;
        continue;
      }
      if (key === 'AND') {
        const list = Array.isArray(condition) ? condition : [condition];
        if (!list.every((entry) => this.matches(model, row, entry))) return false;
        continue;
      }
      if (key === 'NOT') {
        if (this.matches(model, row, condition as Row)) return false;
        continue;
      }

      const value = row[key];
      const isOperatorObject =
        condition !== null &&
        typeof condition === 'object' &&
        !(condition instanceof Date) &&
        !Array.isArray(condition) &&
        Object.keys(condition as Row).some((inner) => OPERATOR_KEYS.includes(inner));

      if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition) && !isOperatorObject) {
        // Nested relation filter.
        const related = this.relatedRows(model, row, key);
        const isToMany = RELATIONS[model][key].many;
        const nested = condition as Row;
        const anyMatch = related.some((candidate) => this.matches(RELATIONS[model][key].model, candidate, nested));
        const allMatch = related.length > 0 && related.every((candidate) => this.matches(RELATIONS[model][key].model, candidate, nested));
        const expectedSome = nested.some !== undefined ? Boolean(nested.some) : undefined;
        if (expectedSome === false) {
          if (allMatch) return false;
        } else if (!anyMatch) {
          return false;
        }
        if (!isToMany && related.length === 0) return false;
        continue;
      }

      if (isOperatorObject) {
        const operators = condition as Row;
        if ('equals' in operators && !looseEquals(value, operators.equals)) return false;
        if ('in' in operators && !(operators.in as unknown[]).some((entry) => looseEquals(value, entry))) return false;
        if ('notIn' in operators && (operators.notIn as unknown[]).some((entry) => looseEquals(value, entry))) return false;
        if ('contains' in operators) {
          const haystack = String(value ?? '').toLowerCase();
          const needle = String(operators.contains).toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if ('startsWith' in operators && !String(value ?? '').startsWith(String(operators.startsWith))) return false;
        if ('endsWith' in operators && !String(value ?? '').endsWith(String(operators.endsWith))) return false;
        if ('gte' in operators && !(Number(value) >= Number(operators.gte))) return false;
        if ('lte' in operators && !(Number(value) <= Number(operators.lte))) return false;
        if ('gt' in operators && !(Number(value) > Number(operators.gt))) return false;
        if ('lt' in operators && !(Number(value) < Number(operators.lt))) return false;
        if ('has' in operators && !(Array.isArray(value) && value.includes(operators.has))) return false;
        if ('hasSome' in operators && !(Array.isArray(value) && (operators.hasSome as unknown[]).some((entry) => value.includes(entry)))) return false;
        if ('not' in operators && looseEquals(value, operators.not)) return false;
        continue;
      }

      if (!looseEquals(value, condition)) return false;
    }
    return true;
  }

  private sort(model: string, rows: Row[], orderBy: Row | Row[] | undefined): Row[] {
    if (!orderBy) return rows;
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const clause of clauses) {
        for (const [field, direction] of Object.entries(clause)) {
          if (field === '_count') continue;
          const dir = direction === 'desc' ? -1 : 1;
          const av = a[field];
          const bv = b[field];
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir;
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        }
      }
      return 0;
    });
  }

  private project(model: string, row: Row, args: Row): Row {
    const result: Row = { ...row };

    if (args.include) {
      for (const [field, value] of Object.entries(args.include as Row)) {
        if (value === false) continue;
        const relation = RELATIONS[model]?.[field];
        if (!relation) continue;
        const nestedArgs = typeof value === 'object' ? (value as Row) : {};
        const related = this.relatedRows(model, row, field);
        const mapped = related
          .filter((candidate) => this.matches(relation.model, candidate, nestedArgs.where))
          .map((candidate) => this.project(relation.model, candidate, nestedArgs));
        const sorted = this.sort(relation.model, mapped, nestedArgs.orderBy);
        const limited = nestedArgs.take ? sorted.slice(0, nestedArgs.take) : sorted;
        result[field] = relation.many ? limited : (limited[0] ?? null);
      }
    }

    if (args.select) {
      const selected: Row = {};
      for (const [field, value] of Object.entries(args.select as Row)) {
        if (value === true) {
          selected[field] = row[field];
          continue;
        }
        const relation = RELATIONS[model]?.[field];
        if (!relation) continue;
        const nestedArgs = (value as Row) ?? {};
        const related = this.relatedRows(model, row, field);
        const mapped = related
          .filter((candidate) => this.matches(relation.model, candidate, nestedArgs.where))
          .map((candidate) => this.project(relation.model, candidate, nestedArgs));
        const sorted = this.sort(relation.model, mapped, nestedArgs.orderBy);
        selected[field] = relation.many ? (nestedArgs.take ? sorted.slice(0, nestedArgs.take) : sorted) : (sorted[0] ?? null);
      }
      if (args.select._count) {
        const counts = (args.select._count as Row).select ?? {};
        const countResult: Row = {};
        for (const [field, value] of Object.entries(counts)) {
          const relation = RELATIONS[model]?.[field];
          if (!relation) continue;
          const nestedArgs = (value as Row) ?? {};
          const related = this.relatedRows(model, row, field).filter((candidate) =>
            this.matches(relation.model, candidate, nestedArgs.where),
          );
          countResult[field] = related.length;
        }
        selected._count = countResult;
      }
      if (args.select._avg || args.select._count === true) {
        // handled by aggregate()
      }
      return selected;
    }

    if (args._count) {
      const counts = (args._count as Row).select ?? {};
      const countResult: Row = {};
      for (const [field, value] of Object.entries(counts)) {
        const relation = RELATIONS[model]?.[field];
        if (!relation) continue;
        const nestedArgs = (value as Row) ?? {};
        countResult[field] = this.relatedRows(model, row, field).filter((candidate) =>
          this.matches(relation.model, candidate, nestedArgs.where),
        ).length;
      }
      result._count = countResult;
    }

    return result;
  }

  private modelApi(model: string) {
    const self = this;
    return {
      async findMany(args: Row = {}) {
        const matched = self.rows(model).filter((row) => self.matches(model, row, args.where));
        const sorted = self.sort(model, matched, args.orderBy);
        const skipped = args.skip ? sorted.slice(args.skip) : sorted;
        const limited = args.take ? skipped.slice(0, args.take) : skipped;
        return limited.map((row) => self.project(model, row, args));
      },
      async findFirst(args: Row = {}) {
        const found = (await this.findMany({ ...args, take: 1 }))[0];
        return found ?? null;
      },
      async findUnique(args: Row = {}) {
        const where = args.where ?? {};
        const found = self.rows(model).find((row) => self.matches(model, row, where));
        return found ? self.project(model, found, args) : null;
      },
      async findUniqueOrThrow(args: Row = {}) {
        const found = await this.findUnique(args);
        if (!found) throw new Error(`FakePrisma: ${model} not found`);
        return found;
      },
      async count(args: Row = {}) {
        return self.rows(model).filter((row) => self.matches(model, row, args.where)).length;
      },
      async create(args: Row = {}) {
        const data = stripUndefined({ ...(args.data ?? {}) });
        const nested: Array<[string, Row]> = [];
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && ('create' in (value as Row))) {
            nested.push([key, value as Row]);
            delete data[key];
          }
        }
        if (model === 'order' && !data.orderCode) data.orderCode = self.nextOrderCode();
        const row = self.applyDefaults(model, data);
        self.rows(model).push(row);

        for (const [field, spec] of nested) {
          const relation = RELATIONS[model][field];
          const children = Array.isArray(spec.create) ? spec.create : [spec.create];
          for (const child of children) {
            await (self as any)[relation.model].create({
              data: {
                ...child,
                ...(relation.foreignKey === 'id' ? {} : { [relation.foreignKey]: row.id }),
              },
            });
          }
        }
        return self.project(model, row, args);
      },
      async createMany(args: Row = {}) {
        const list = Array.isArray(args.data) ? args.data : [args.data];
        const created = list.map((item: Row) => {
          const row = self.applyDefaults(model, item);
          self.rows(model).push(row);
          return row;
        });
        return { count: created.length };
      },
      async update(args: Row = {}) {
        const row = self.rows(model).find((candidate) => self.matches(model, candidate, args.where));
        if (!row) {
          const error = new Error(`FakePrisma: ${model} record not found for update`) as Error & { code?: string };
          error.code = 'P2025';
          throw error;
        }
        const data = stripUndefined({ ...(args.data ?? {}) });
        const increments: Array<[string, number]> = [];
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
            const spec = value as Row;
            if ('increment' in spec) {
              increments.push([key, Number(spec.increment)]);
              delete data[key];
            } else if ('set' in spec) {
              data[key] = spec.set;
            }
          }
        }
        Object.assign(row, data);
        for (const [key, amount] of increments) row[key] = Number(row[key] ?? 0) + amount;
        coerceDecimals(model, row);
        if (DEFAULTS[model]?.().updatedAt) row.updatedAt = new Date();
        return self.project(model, row, args);
      },
      async updateMany(args: Row = {}) {
        const targets = self.rows(model).filter((row) => self.matches(model, row, args.where));
        const patch = stripUndefined({ ...(args.data ?? {}) });
        for (const row of targets) Object.assign(row, patch);
        return { count: targets.length };
      },
      async upsert(args: Row = {}) {
        const existing = self.rows(model).find((row) => self.matches(model, row, args.where));
        if (existing) {
          Object.assign(existing, stripUndefined({ ...(args.update ?? {}) }));
          coerceDecimals(model, existing);
          return self.project(model, existing, args);
        }
        return this.create({ data: args.create ?? {}, ...(args.include ? { include: args.include } : {}) });
      },
      async delete(args: Row = {}) {
        const index = self.rows(model).findIndex((row) => self.matches(model, row, args.where));
        if (index === -1) {
          const error = new Error(`FakePrisma: ${model} record not found for delete`) as Error & { code?: string };
          error.code = 'P2025';
          throw error;
        }
        const [removed] = self.rows(model).splice(index, 1);
        return removed;
      },
      async deleteMany(args: Row = {}) {
        const keep: Row[] = [];
        let count = 0;
        for (const row of self.rows(model)) {
          if (self.matches(model, row, args.where)) count += 1;
          else keep.push(row);
        }
        self.tables[model] = keep;
        return { count };
      },
      async aggregate(args: Row = {}) {
        const matched = self.rows(model).filter((row) => self.matches(model, row, args.where));
        const result: Row = {};
        for (const [key, value] of Object.entries(args._avg ?? {})) {
          const values = matched.map((row) => Number(row[key])).filter((entry) => !Number.isNaN(entry));
          result._avg = { ...(result._avg ?? {}), [key]: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
        }
        for (const [key, value] of Object.entries(args._sum ?? {})) {
          const values = matched.map((row) => Number(row[key])).filter((entry) => !Number.isNaN(entry));
          result._sum = { ...(result._sum ?? {}), [key]: values.length ? values.reduce((a, b) => a + b, 0) : null };
        }
        for (const key of Object.keys(args._count ?? {})) {
          result._count = { ...(result._count ?? {}), [key]: matched.length, _all: matched.length };
        }
        return result;
      },
      async groupBy(args: Row = {}) {
        const matched = self.rows(model).filter((row) => self.matches(model, row, args.where));
        const groups = new Map<string, Row[]>();
        for (const row of matched) {
          const key = (args.by as string[]).map((field) => String(row[field])).join('|');
          const bucket = groups.get(key) ?? [];
          bucket.push(row);
          groups.set(key, bucket);
        }
        let result = [...groups.values()].map((bucket) => {
          const entry: Row = {};
          for (const field of args.by as string[]) entry[field] = bucket[0][field];
          if (args._count) entry._count = { _all: bucket.length };
          if (args._sum) {
            entry._sum = {};
            for (const field of Object.keys(args._sum as Row)) {
              entry._sum[field] = bucket.reduce((acc, row) => acc + Number(row[field] ?? 0), 0);
            }
          }
          return entry;
        });
        const orderBy = args.orderBy as Row | undefined;
        if (orderBy) {
          result = result.sort((a, b) => {
            for (const [field, direction] of Object.entries(orderBy)) {
              const dir = direction === 'desc' ? -1 : 1;
              if (field === '_sum') {
                const inner = Object.keys(direction as Row)[0];
                const av = Number(a._sum?.[inner] ?? 0);
                const bv = Number(b._sum?.[inner] ?? 0);
                if (av !== bv) return (av - bv) * dir;
                continue;
              }
              const av = a[field];
              const bv = b[field];
              if (av === bv) continue;
              return String(av).localeCompare(String(bv)) * dir;
            }
            return 0;
          });
        }
        return args.take ? result.slice(0, args.take) : result;
      },
    };
  }

  // Prisma model delegates are exposed as properties.
  get userProfile() { return this.modelApi('userProfile'); }
  get business() { return this.modelApi('business'); }
  get businessMember() { return this.modelApi('businessMember'); }
  get businessHour() { return this.modelApi('businessHour'); }
  get businessFaq() { return this.modelApi('businessFaq'); }
  get product() { return this.modelApi('product'); }
  get recentBusiness() { return this.modelApi('recentBusiness'); }
  get conversation() { return this.modelApi('conversation'); }
  get message() { return this.modelApi('message'); }
  get conversationFeedback() { return this.modelApi('conversationFeedback'); }
  get order() { return this.modelApi('order'); }
  get orderItem() { return this.modelApi('orderItem'); }
  get orderStatusEvent() { return this.modelApi('orderStatusEvent'); }
  get orderReview() { return this.modelApi('orderReview'); }
  get notificationLog() { return this.modelApi('notificationLog'); }

  async $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async $queryRaw(): Promise<unknown[]> {
    return [{ '1': 1 }];
  }

  async $disconnect(): Promise<void> {
    return undefined;
  }
}

export function createFakePrisma(): FakePrisma {
  return new FakePrisma();
}
