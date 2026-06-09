const COMMAND_LABELS: Record<string, string> = {
  add_item: "Add item",
  remove_item: "Remove item",
  clear_order: "Clear ticket",
  submit_order: "Submit ticket",
  send_to_terminal: "Send to terminal",
  create_item: "Create menu item",
  update_item: "Update menu item",
  delete_item: "Delete menu item",
  apply_discount: "Apply discount",
  adjust_inventory: "Adjust inventory",
  set_inventory: "Set inventory count",
  transfer_inventory: "Transfer inventory",
  batch_adjust_inventory: "Adjust inventory",
  create_customer: "Create customer",
  update_customer: "Update customer",
  refund_payment: "Refund payment",
  cancel_payment: "Cancel payment",
  clock_in: "Clock in",
  clock_out: "Clock out",
  send_email: "Send email",
  database_query: "Run data query",
};

export function commandLabel(commandName: string): string {
  return COMMAND_LABELS[commandName] ?? commandName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

