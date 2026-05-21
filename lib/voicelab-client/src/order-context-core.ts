/**
 * Pure order reducer logic shared between PWA and any future client surfaces.
 * React provider stays in each surface; this module only exports types + reducer.
 */

export interface CatalogItem {
  id: string;
  variationId: string;
  name: string;
  price: number;
  description?: string;
}

export interface OrderLineItem {
  id: string;
  catalogItem: CatalogItem;
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

export type OrderAction =
  | { type: "add_item"; catalogItem: CatalogItem; quantity?: number }
  | { type: "remove_item"; lineItemId: string }
  | { type: "update_quantity"; lineItemId: string; quantity: number }
  | { type: "clear" }
  | { type: "mark_submitted"; squareOrderId?: string };

const genId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

function calcTotal(items: OrderLineItem[]): number {
  return items.reduce((s, i) => s + i.catalogItem.price * i.quantity, 0);
}

export function orderReducer(state: Order | null, action: OrderAction): Order | null {
  switch (action.type) {
    case "add_item": {
      const qty = action.quantity ?? 1;
      const order = state || { id: genId(), items: [], createdAt: new Date(), status: "draft" as const, total: 0 };
      const existing = order.items.find((i) => i.catalogItem.id === action.catalogItem.id);
      const newItems = existing
        ? order.items.map((i) =>
            i.catalogItem.id === action.catalogItem.id
              ? { ...i, quantity: i.quantity + qty }
              : i,
          )
        : [...order.items, { id: genId(), catalogItem: action.catalogItem, quantity: qty }];
      return { ...order, items: newItems, total: calcTotal(newItems) };
    }
    case "remove_item": {
      if (!state) return null;
      const newItems = state.items.filter((i) => i.id !== action.lineItemId);
      return newItems.length ? { ...state, items: newItems, total: calcTotal(newItems) } : null;
    }
    case "update_quantity": {
      if (!state) return null;
      if (action.quantity <= 0) {
        const newItems = state.items.filter((i) => i.id !== action.lineItemId);
        return newItems.length ? { ...state, items: newItems, total: calcTotal(newItems) } : null;
      }
      const newItems = state.items.map((i) =>
        i.id === action.lineItemId ? { ...i, quantity: action.quantity } : i,
      );
      return { ...state, items: newItems, total: calcTotal(newItems) };
    }
    case "clear":
      return null;
    case "mark_submitted": {
      if (!state?.items.length) return null;
      return { ...state, status: "completed", squareOrderId: action.squareOrderId };
    }
    default:
      return state;
  }
}
