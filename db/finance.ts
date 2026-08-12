/** Thanh toán và sổ thu chi. */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { ISO_DATE, nextCode, ValidationError, writeAudit } from "./internal";
import { contracts, invoices, ledgerEntries, paymentAllocations, payments, rooms } from "./schema";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ghi nhận một khoản thu và cấn vào đơn.
 *
 * Cập nhật `invoices.paid_amount` cùng trạng thái đơn ngay trong thao tác này
 * để số công nợ không lệch, và sinh luôn dòng thu trong sổ thu chi. D1 chưa hỗ
 * trợ transaction tương tác nên các bước chạy tuần tự; hỏng giữa chừng sẽ để
 * lại khoản thanh toán chưa cấn, phát hiện được bằng cách đối chiếu
 * `payment_allocations` với `invoices.paid_amount`.
 */
export async function recordPayment(input: {
  invoiceId: string;
  amount: number;
  method?: "cash" | "transfer" | "card" | "other";
  paidAt?: string;
  note?: string;
  actorId: string;
}) {
  const db = getDb();

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError("Số tiền phải là số nguyên VNĐ lớn hơn 0.", "amount");
  }

  const [invoice] = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      status: invoices.status,
      contractId: invoices.contractId,
      roomId: invoices.roomId,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId))
    .limit(1);
  if (!invoice) throw new ValidationError("Không tìm thấy đơn thu.", "invoiceId");
  if (invoice.status === "cancelled") {
    throw new ValidationError("Đơn đã hủy, không ghi nhận thanh toán được.", "invoiceId");
  }

  const remaining = invoice.total - invoice.paidAmount;
  if (remaining <= 0) throw new ValidationError("Đơn này đã thu đủ.", "invoiceId");
  if (input.amount > remaining) {
    throw new ValidationError(
      `Số tiền vượt quá phần còn nợ (${remaining.toLocaleString("vi-VN")}đ).`,
      "amount",
    );
  }

  const [contract] = await db
    .select({ guestId: contracts.primaryGuestId })
    .from(contracts)
    .where(eq(contracts.id, invoice.contractId))
    .limit(1);
  if (!contract) throw new ValidationError("Đơn thu không gắn với hợp đồng nào.", "invoiceId");

  const [roomRow] = await db
    .select({ propertyId: rooms.propertyId })
    .from(rooms)
    .where(eq(rooms.id, invoice.roomId))
    .limit(1);

  const paidAt = input.paidAt && ISO_DATE.test(input.paidAt) ? input.paidAt : todayIso();
  const paymentId = newId("pay");

  await db.insert(payments).values({
    id: paymentId,
    code: await nextCode(db, payments, payments.code, "TT", 4),
    guestId: contract.guestId,
    amount: input.amount,
    method: input.method ?? "transfer",
    paidAt,
    note: input.note?.trim() || `Thu cho đơn ${invoice.code}`,
    recordedBy: input.actorId,
  });

  await db.insert(paymentAllocations).values({
    id: newId("pal"),
    paymentId,
    invoiceId: invoice.id,
    amount: input.amount,
  });

  const newPaid = invoice.paidAmount + input.amount;
  await db
    .update(invoices)
    .set({
      paidAmount: newPaid,
      status: newPaid >= invoice.total ? "paid" : "partial",
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(invoices.id, invoice.id));

  await db.insert(ledgerEntries).values({
    id: newId("led"),
    code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
    propertyId: roomRow?.propertyId ?? null,
    direction: "in",
    category: "Tiền phòng",
    description: `Thu đơn ${invoice.code}`,
    amount: input.amount,
    occurredAt: paidAt,
    paymentId,
    recordedBy: input.actorId,
  });

  await writeAudit(db, {
    actorId: input.actorId,
    action: "payment.record",
    entityType: "invoice",
    entityId: invoice.id,
    changes: { amount: input.amount, paidAmount: newPaid, total: invoice.total },
  });

  return { paymentId, paidAmount: newPaid, remaining: invoice.total - newPaid };
}

/** Ghi một khoản thu/chi nhập tay, ví dụ tiền sửa chữa hay điện khu vực chung. */
export async function createLedgerEntry(input: {
  direction: "in" | "out";
  category: string;
  description?: string;
  amount: number;
  occurredAt?: string;
  propertyId?: string | null;
  actorId: string;
}) {
  const db = getDb();

  if (input.direction !== "in" && input.direction !== "out") {
    throw new ValidationError("Chiều giao dịch không hợp lệ.", "direction");
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError("Số tiền phải là số nguyên VNĐ lớn hơn 0.", "amount");
  }
  if (!input.category.trim()) {
    throw new ValidationError("Cần chọn nhóm giao dịch.", "category");
  }

  const id = newId("led");
  await db.insert(ledgerEntries).values({
    id,
    code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
    propertyId: input.propertyId || null,
    direction: input.direction,
    category: input.category.trim(),
    description: input.description?.trim() ?? "",
    amount: input.amount,
    occurredAt:
      input.occurredAt && ISO_DATE.test(input.occurredAt) ? input.occurredAt : todayIso(),
    recordedBy: input.actorId,
  });

  await writeAudit(db, {
    actorId: input.actorId,
    action: "ledger.create",
    entityType: "ledger_entry",
    entityId: id,
    changes: { direction: input.direction, amount: input.amount, category: input.category },
  });

  return { id };
}
