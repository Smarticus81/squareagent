import React from "react";
import { Minus, Plus, X } from "lucide-react";
import type { OrderLineItem } from "@/contexts/OrderContext";

interface OrderCardProps {
  lineItem: OrderLineItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

export function OrderCard({ lineItem, onIncrement, onDecrement, onRemove }: OrderCardProps) {
  const total = lineItem.catalogItem.price * lineItem.quantity;

  return (
    <div className="order-card">
      <div className="order-card-info">
        <div className="order-card-name">{lineItem.catalogItem.name}</div>
        <div className="order-card-unit">${lineItem.catalogItem.price.toFixed(2)} each</div>
      </div>
      <div className="order-card-right">
        <span className="order-card-total">${total.toFixed(2)}</span>
        <div className="order-card-controls">
          <button className="ctrl-btn" onClick={onDecrement}><Minus size={14} /></button>
          <span className="ctrl-qty">{lineItem.quantity}</span>
          <button className="ctrl-btn" onClick={onIncrement}><Plus size={14} /></button>
          <button className="ctrl-btn ctrl-remove" onClick={onRemove}><X size={14} /></button>
        </div>
      </div>
    </div>
  );
}
