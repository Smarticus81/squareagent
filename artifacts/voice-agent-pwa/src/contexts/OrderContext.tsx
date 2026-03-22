import { createContext, useContext, useState, type ReactNode } from "react";
import { type SquareCatalogItem } from "@/contexts/SquareContext";
import { getBaseUrl } from "@/lib/api";

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
  submitOrder: (accessToken: string, locationId: string) => Promise<{ success: boolean; orderId?: string; error?: string; warning?: string; paymentRecorded?: boolean }>;
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
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [lastSubmittedOrder, setLastSubmittedOrder] = useState<Order | null>(null);
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

  async function submitOrder(accessToken: string, locationId: string) {
    if (!currentOrder?.items.length) return { success: false, error: "No items" };
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitWarning(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/square/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-square-token": accessToken, "x-square-location": locationId },
        body: JSON.stringify({
          items: currentOrder.items.map((i) => ({
            catalogItemId: i.catalogItem.id, variationId: i.catalogItem.variationId,
            quantity: i.quantity, name: i.catalogItem.name, price: i.catalogItem.price,
          })),
        }),
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
    <OrderContext.Provider value={{ currentOrder, lastSubmittedOrder, addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting, submitError, submitWarning }}>
      {children}
    </OrderContext.Provider>
  );
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrder must be used within OrderProvider");
  return ctx;
}
