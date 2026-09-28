// Receipt for a bar/restaurant order once it is marked paid — shared by the staff "Close &
// Generate Receipt" action and by verifying a guest's M-Pesa bill payment (Online bookings & payments).
import type { Order } from "@shared/schema";
import type { IStorage } from "./storage";
import { issueDocument } from "./documents";

const issueDateLabel = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export async function issueOrderReceipt(storage: IStorage, order: Order) {
  const items = await storage.listOrderItems(order.id);
  const doc = await issueDocument(storage, {
    docType: "receipt",
    category: order.outlet === "bar" ? "bar" : "restaurant",
    sourceId: order.id,
    recipientName: order.customerName || "Guest",
    recipientEmail: order.customerEmail,
    issueDate: issueDateLabel(),
    lineItems: items.map((i) => ({ label: `${i.itemName} x${i.quantity}`, amount: i.subtotal })),
    totalAmount: order.totalAmount,
    amountPaid: order.totalAmount,
    balance: 0,
    paymentAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentReference: order.paymentReference,
  });
  return { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
}
