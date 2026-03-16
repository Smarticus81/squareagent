import React, { createContext, useContext, useState, ReactNode } from "react";
import { SquareCatalogItem } from "@/context/SquareContext";
import * as Crypto from "expo-crypto";

export interface OrderLineItem {
  id: string;
  catalogItem: SquareCatalogItem;
  quantity: number;
  note?: string;
}

export interface Order {
  id: string;
  items: OrderLineItem[];
  createdAt: Date;
  status: "draft" | "pending" | "processing" | "completed" | "failed";
  squareOrderId?: string;
  total: number;
}

interface OrderContextType {
  currentOrder: Order | null;
  addItem: (item: SquareCatalogItem, quantity?: number) => void;
  removeItem: (lineItemId: string) => void;
  updateQuantity: (lineItemId: string, quantity: number) => void;
  clearOrder: () => void;
  submitOrder: (accessToken: string, locationId: string) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  isSubmitting: boolean;
  submitError: string | null;
  orderHistory: Order[];
}

const OrderContext = createContext<OrderContextType | null>(null);

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);

  function ensureOrder(): Order {
    if (currentOrder) return currentOrder;
    const newOrder: Order = {
      id: generateId(),
      items: [],
      createdAt: new Date(),
      status: "draft",
      total: 0,
    };
    setCurrentOrder(newOrder);
    return newOrder;
  }

  function calcTotal(items: OrderLineItem[]): number {
    return items.reduce((sum, item) => sum + item.catalogItem.price * item.quantity, 0);
  }

  function addItem(catalogItem: SquareCatalogItem, quantity = 1) {
    setCurrentOrder((prev) => {
      const order = prev || {
        id: generateId(),
        items: [],
        createdAt: new Date(),
        status: "draft" as const,
        total: 0,
      };

      const existing = order.items.find((i) => i.catalogItem.id === catalogItem.id);
      let newItems: OrderLineItem[];

      if (existing) {
        newItems = order.items.map((i) =>
          i.catalogItem.id === catalogItem.id
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      } else {
        newItems = [
          ...order.items,
          { id: generateId(), catalogItem, quantity },
        ];
      }

      return { ...order, items: newItems, total: calcTotal(newItems) };
    });
  }

  function removeItem(lineItemId: string) {
    setCurrentOrder((prev) => {
      if (!prev) return null;
      const newItems = prev.items.filter((i) => i.id !== lineItemId);
      if (newItems.length === 0) return null;
      return { ...prev, items: newItems, total: calcTotal(newItems) };
    });
  }

  function updateQuantity(lineItemId: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(lineItemId);
      return;
    }
    setCurrentOrder((prev) => {
      if (!prev) return null;
      const newItems = prev.items.map((i) =>
        i.id === lineItemId ? { ...i, quantity } : i
      );
      return { ...prev, items: newItems, total: calcTotal(newItems) };
    });
  }

  function clearOrder() {
    setCurrentOrder(null);
    setSubmitError(null);
  }

  async function submitOrder(
    accessToken: string,
    locationId: string
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (!currentOrder || currentOrder.items.length === 0) {
      return { success: false, error: "No items in order" };
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
        ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/`
        : "http://localhost:3000/";

      const response = await fetch(`${baseUrl}api/square/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-square-token": accessToken,
          "x-square-location": locationId,
        },
        body: JSON.stringify({
          items: currentOrder.items.map((item) => ({
            catalogItemId: item.catalogItem.id,
            variationId: item.catalogItem.variationId,
            quantity: item.quantity,
            name: item.catalogItem.name,
            price: item.catalogItem.price,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      const completedOrder: Order = {
        ...currentOrder,
        status: "completed",
        squareOrderId: data.orderId,
      };

      setOrderHistory((prev) => [completedOrder, ...prev]);
      setCurrentOrder(null);

      return { success: true, orderId: data.orderId };
    } catch (e: any) {
      const errMsg = e.message || "Failed to submit order";
      setSubmitError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <OrderContext.Provider
      value={{
        currentOrder,
        addItem,
        removeItem,
        updateQuantity,
        clearOrder,
        submitOrder,
        isSubmitting,
        submitError,
        orderHistory,
      }}
    >
      {children}
    </OrderContext.Provider>
  );
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrder must be used within OrderProvider");
  return ctx;
}
