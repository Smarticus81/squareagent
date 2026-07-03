import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type SquareCatalogItem } from "@/contexts/SquareContext";
import { getBaseUrl } from "@/lib/api";

// Per-tab draft persistence: a refresh (or iOS tab eviction) mid-order must
// not empty the ticket. sessionStorage keeps drafts isolated per tab.
const DRAFT_ORDER_KEY = "voycelab_draft_order";

function restoreDraftOrder(): Order | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return { ...parsed, createdAt: new Date(parsed.createdAt) } as Order;
  } catch {
    return null;
  }
}

export interface OrderLineItem {
  id: string;
  catalogItem: SquareCatalogItem;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderLineItem[];
  createdAt: Date;
  status: "draft" | "pending" | "completed" | "failed";
  squareOrderId?: string;
  total: number;
}

interface OrderContextType {
  currentOrder: Order | null;
  lastSubmittedOrder: Order | null;
  addItem: (item: SquareCatalogItem, quantity?: number) => void;
  removeItem: (lineItemId: string) => void;
  updateQuantity: (lineItemId: string, quantity: number) => void;
  clearOrder: () => void;
  /** Mark the current order as submitted by the voice agent (Square was already called server-side). */
  markVoiceOrderSubmitted: () => void;
  submitOrder: (venueId?: string | null, authToken?: string | null) => Promise<{ success: boolean; orderId?: string; error?: string; warning?: string; paymentRecorded?: boolean }>;
  isSubmitting: boolean;
  submitError: string | null;
  submitWarning: string | null;
}

const OrderContext = createContext<OrderContextType | null>(null);
const genId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

function calcTotal(items: OrderLineItem[]): number {
  return items.reduce((s, i) => s + i.catalogItem.price * i.quantity, 0);
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const [currentOrder, setCurrentOrder] = useState<Order | null>(restoreDraftOrder);
  const [lastSubmittedOrder, setLastSubmittedOrder] = useState<Order | null>(null);

  useEffect(() => {
    try {
      if (currentOrder?.items.length) {
        sessionStorage.setItem(DRAFT_ORDER_KEY, JSON.stringify(currentOrder));
      } else {
        sessionStorage.removeItem(DRAFT_ORDER_KEY);
      }
    } catch {
      // storage may be unavailable (private mode) — drafts just won't survive refresh
    }
  }, [currentOrder]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);

  function addItem(catalogItem: SquareCatalogItem, quantity = 1) {
    setLastSubmittedOrder(null);
    setSubmitError(null);
    setSubmitWarning(null);
    setCurrentOrder((prev) => {
      const order = prev || { id: genId(), items: [], createdAt: new Date(), status: "draft" as const, total: 0 };
      const existing = order.items.find((i) => i.catalogItem.id === catalogItem.id);
      const newItems = existing
        ? order.items.map((i) => i.catalogItem.id === catalogItem.id ? { ...i, quantity: i.quantity + quantity } : i)
        : [...order.items, { id: genId(), catalogItem, quantity }];
      return { ...order, items: newItems, total: calcTotal(newItems) };
    });
  }

  function removeItem(id: string) {
    setCurrentOrder((prev) => {
      if (!prev) return null;
      const newItems = prev.items.filter((i) => i.id !== id);
      return newItems.length ? { ...prev, items: newItems, total: calcTotal(newItems) } : null;
    });
  }

  function updateQuantity(id: string, qty: number) {
    if (qty <= 0) return removeItem(id);
    setCurrentOrder((prev) => {
      if (!prev) return null;
      const newItems = prev.items.map((i) => i.id === id ? { ...i, quantity: qty } : i);
      return { ...prev, items: newItems, total: calcTotal(newItems) };
    });
  }

  function clearOrder() {
    setCurrentOrder(null);
    setSubmitError(null);
    setSubmitWarning(null);
  }

  /** Called when the voice agent has already submitted the order server-side; just updates UI state. */
  function markVoiceOrderSubmitted() {
    if (!currentOrder?.items.length) return;
    const done: Order = { ...currentOrder, status: "completed" };
    setCurrentOrder(null);
    setLastSubmittedOrder(done);
    setTimeout(() => setLastSubmittedOrder(null), 5000);
  }

  async function submitOrder(venueId?: string | null, authToken?: string | null) {
    if (!currentOrder?.items.length) return { success: false, error: "No items" };
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitWarning(null);
    try {
      const items = currentOrder.items.map((i) => ({
        catalogItemId: i.catalogItem.id, variationId: i.catalogItem.variationId,
        quantity: i.quantity, name: i.catalogItem.name, price: i.catalogItem.price,
      }));
      if (!venueId || !authToken) {
        throw new Error("Square is not connected.");
      }

      const res = await fetch(`${getBaseUrl()}api/venues/${encodeURIComponent(venueId)}/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ items }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const done: Order = { ...currentOrder, status: "completed", squareOrderId: data.orderId };
      setCurrentOrder(null);
      setLastSubmittedOrder(done);
      if (data.warning) {
        setSubmitWarning(data.warning);
      }
      setTimeout(() => setLastSubmittedOrder(null), 5000);
      return { success: true, orderId: data.orderId, warning: data.warning, paymentRecorded: data.paymentRecorded };
    } catch (e: any) {
      setSubmitError(e.message);
      return { success: false, error: e.message };
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <OrderContext.Provider value={{ currentOrder, lastSubmittedOrder, addItem, removeItem, updateQuantity, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting, submitError, submitWarning }}>
      {children}
    </OrderContext.Provider>
  );
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrder must be used within OrderProvider");
  return ctx;
}
