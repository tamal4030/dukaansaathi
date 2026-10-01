import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'dukaansaathi.carts';
const MAX_QUANTITY = 200;

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: string;
  availability: string;
  quantity: number;
}

type Carts = Record<string, CartLine[]>;

export interface CartValue {
  businessId: string | null;
  lines: CartLine[];
  count: number;
  /** Opens the cart for a specific shop; a cart only ever holds one shop. */
  setBusiness: (businessId: string) => void;
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  totalItems: (businessId: string) => number;
}

const CartContext = createContext<CartValue | null>(null);

function readCarts(): Carts {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Carts) : {};
  } catch {
    return {};
  }
}

/**
 * Carts are kept per shop in browser storage so a guest's selection survives the
 * Google sign-in redirect. Totals shown here are indicative only: the backend
 * recalculates every price from PostgreSQL before an order is created.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Carts>(() => (typeof window === 'undefined' ? {} : readCarts()));
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(carts));
    } catch {
      // Storage is a convenience here; the server is the source of truth.
    }
  }, [carts]);

  const setBusiness = useCallback((next: string) => setBusinessId(next), []);

  const add = useCallback<CartValue['add']>(
    (line, quantity = 1) => {
      setCarts((current) => {
        const existing = current[businessId ?? ''] ?? [];
        const found = existing.find((entry) => entry.productId === line.productId);
        const updated = found
          ? existing.map((entry) =>
              entry.productId === line.productId
                ? { ...entry, quantity: Math.min(MAX_QUANTITY, entry.quantity + quantity) }
                : entry,
            )
          : [...existing, { ...line, quantity }];
        return { ...current, [businessId ?? '']: updated };
      });
    },
    [businessId],
  );

  const setQuantity = useCallback<CartValue['setQuantity']>(
    (productId, quantity) => {
      setCarts((current) => {
        const key = businessId ?? '';
        const existing = current[key] ?? [];
        const updated =
          quantity <= 0
            ? existing.filter((entry) => entry.productId !== productId)
            : existing.map((entry) =>
                entry.productId === productId ? { ...entry, quantity: Math.min(MAX_QUANTITY, quantity) } : entry,
              );
        return { ...current, [key]: updated };
      });
    },
    [businessId],
  );

  const remove = useCallback<CartValue['remove']>(
    (productId) => {
      setCarts((current) => {
        const key = businessId ?? '';
        return { ...current, [key]: (current[key] ?? []).filter((entry) => entry.productId !== productId) };
      });
    },
    [businessId],
  );

  const clear = useCallback(() => {
    setCarts((current) => ({ ...current, [businessId ?? '']: [] }));
  }, [businessId]);

  const lines = useMemo(() => (businessId ? (carts[businessId] ?? []) : []), [carts, businessId]);
  const count = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  const value = useMemo<CartValue>(
    () => ({
      businessId,
      lines,
      count,
      setBusiness,
      add,
      setQuantity,
      remove,
      clear,
      totalItems: (id: string) => (carts[id] ?? []).reduce((sum, line) => sum + line.quantity, 0),
    }),
    [businessId, lines, count, carts, setBusiness, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}
