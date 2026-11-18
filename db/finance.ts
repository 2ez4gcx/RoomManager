/** Thanh toán và sổ thu chi. */
import { and, eq, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "./index";
import { newId } from "./ids";
import {
  isRealDate,
  MAX_AMOUNT,
  nextCode,
  todayInVietnam,
  ValidationError,
  withCodeRetry,
  writeAudit,
} from "./internal";
import {
  contracts,
  invoices,
  ledgerEntries,
  paymentAllocations,
  payments,
  rooms,
  type InvoiceStatus,
} from "./schema";

const PAYMENT_METHODS = ["cash", "transfer", "card", "other"] as const;

/**
 * Ngày của giao dịch. Bỏ trống thì lấy hôm nay (giờ Việt Nam); nhập sai thì báo
 * lỗi. Trước đây ngày sai bị lặng lẽ thay bằng hôm nay — khoản thu của tháng
 * trước rơi sang tháng này mà không ai biết.
 */
function transactionDate(value: string | undefined, field: string) {
  if (!value) return todayInVietnam();
  if (!isRealDate(value)) throw new ValidationError("Ngày không hợp lệ.", field);
  return value;
}

/**
 * Ghi nhận một khoản thu và cấn vào đơn.
 *
 * D1 không có transaction tương tác, nên thao tác chia làm hai bước, mỗi bước
 * tự nó nguyên tử:
 *
 * 1. "Giữ chỗ" trên đơn bằng MỘT câu UPDATE có điều kiện: cộng thẳng vào
 *    `paid_amount` trong SQL, chỉ khi đơn chưa hủy và cộng xong không vượt
 *    `total`. Hai yêu cầu song song (bấm đúp) không thể cùng lọt: câu thứ hai
 *    thấy số đã cộng của câu thứ nhất. Đọc `paid_amount` ra rồi ghi lại số
 *    tuyệt đối — cách làm cũ — thì cả hai cùng đọc số cũ, sổ quỹ ghi hai khoản
 *    thu mà đơn chỉ ghi một.
 * 2. Ghi khoản thanh toán, dòng cấn trừ và dòng sổ quỹ trong một `db.batch`
 *    (D1 chạy cả lô trong một transaction). Lô hỏng thì trả lại phần đã giữ ở
 *    bước 1, nên không còn trạng thái "đơn đã trả mà không có khoản thu".
 */
export async function recordPayment(input: {
  invoiceId: string;
  amount: number;
  method?: "cash" | "transfer" | "card" | "other";
  paidAt?: string;
  note?: string;
  actorId: string;
  /** Nhóm hiện trong sổ thu chi. Mặc định là tiền phòng. */
  category?: string;
  /**
   * Bỏ qua bước ghi sổ quỹ.
   *
   * Dùng khi cấn trừ từ tiền cọc: tiền mặt đã vào sổ ngay lúc thu cọc, ghi
   * thêm lần nữa ở đây là đếm hai lần.
   */
  skipLedger?: boolean;
}) {
  const db = getDb();

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError("Số tiền phải là số nguyên VNĐ lớn hơn 0.", "amount");
  }
  if (input.amount > MAX_AMOUNT) {
    throw new ValidationError("Số tiền quá lớn. Kiểm tra lại có gõ thừa số 0 không.", "amount");
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

  const paidAt = transactionDate(input.paidAt, "paidAt");
  if (input.method && !(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    throw new ValidationError("Hình thức thanh toán không hợp lệ.", "method");
  }
  const paymentId = newId("pay");

  // Bước 1: giữ chỗ trên đơn. Điều kiện nằm trong chính câu UPDATE.
  const [claimed] = await db
    .update(invoices)
    .set({
      paidAmount: sql`${invoices.paidAmount} + ${input.amount}`,
      status: sql<InvoiceStatus>`CASE WHEN ${invoices.paidAmount} + ${input.amount} >= ${invoices.total} THEN 'paid' ELSE 'partial' END`,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(
      and(
        eq(invoices.id, invoice.id),
        ne(invoices.status, "cancelled"),
        sql`${invoices.paidAmount} + ${input.amount} <= ${invoices.total}`,
      ),
    )
    .returning({ paidAmount: invoices.paidAmount });

  if (!claimed) {
    throw new ValidationError(
      "Đơn này vừa được thu tiền hoặc hủy ở một thao tác khác. Tải lại trang rồi kiểm tra.",
      "invoiceId",
    );
  }
  const newPaid = claimed.paidAmount;

  // Bước 2: ghi chứng từ trong một lô nguyên tử.
  try {
    await withCodeRetry(async () => {
      const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
        db.insert(payments).values({
          id: paymentId,
          code: await nextCode(db, payments, payments.code, "TT", 4),
          guestId: contract.guestId,
          amount: input.amount,
          method: input.method ?? "transfer",
          paidAt,
          note: input.note?.trim() || `Thu cho đơn ${invoice.code}`,
          recordedBy: input.actorId,
        }),
        db.insert(paymentAllocations).values({
          id: newId("pal"),
          paymentId,
          invoiceId: invoice.id,
          amount: input.amount,
        }),
      ];

      if (!input.skipLedger) {
        statements.push(
          db.insert(ledgerEntries).values({
            id: newId("led"),
            code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
            propertyId: roomRow?.propertyId ?? null,
            direction: "in",
            category: input.category ?? "Tiền phòng",
            description: `Thu đơn ${invoice.code}`,
            amount: input.amount,
            occurredAt: paidAt,
            paymentId,
            recordedBy: input.actorId,
          }),
        );
      }

      await db.batch(statements);
    });
  } catch (error) {
    // Trả lại phần đã giữ, nếu không đơn sẽ báo đã thu một khoản không có
    // chứng từ. Nhưng lô có thể đã ghi xong mà chỉ mất phản hồi: khi đó khoản
    // thanh toán tồn tại và KHÔNG được trả lại, nếu không người dùng thu lại
    // lần nữa và sổ quỹ ghi hai khoản. Không đọc được thì coi như đã ghi —
    // thà để đơn báo đã thu rồi đối chiếu, còn hơn mời thu trùng.
    try {
      const [written] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1);

      if (!written) {
        const unpaidStatus: InvoiceStatus = invoice.status === "draft" ? "draft" : "issued";
        await db
          .update(invoices)
          .set({
            paidAmount: sql`${invoices.paidAmount} - ${input.amount}`,
            status: sql<InvoiceStatus>`CASE WHEN ${invoices.paidAmount} - ${input.amount} <= 0 THEN ${unpaidStatus} ELSE 'partial' END`,
            updatedAt: sql`(unixepoch() * 1000)`,
          })
          .where(and(eq(invoices.id, invoice.id), ne(invoices.status, "cancelled")));
      }
    } catch (rollbackError) {
      console.error("[thanh-toan-khong-hoan-duoc]", invoice.code, rollbackError);
    }
    throw error;
  }

  // Tiền đã ghi xong. Nhật ký hỏng không được biến thao tác thành "thất bại":
  // người gọi sẽ tưởng chưa thu và thu lại.
  try {
    await writeAudit(db, {
      actorId: input.actorId,
      action: "payment.record",
      entityType: "invoice",
      entityId: invoice.id,
      changes: { amount: input.amount, paidAmount: newPaid, total: invoice.total },
    });
  } catch (auditError) {
    console.error("[nhat-ky-thanh-toan]", invoice.code, auditError);
  }

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
  if (input.amount > MAX_AMOUNT) {
    throw new ValidationError("Số tiền quá lớn. Kiểm tra lại có gõ thừa số 0 không.", "amount");
  }
  if (!input.category.trim()) {
    throw new ValidationError("Cần chọn nhóm giao dịch.", "category");
  }
  const occurredAt = transactionDate(input.occurredAt, "occurredAt");

  const id = newId("led");
  await db.insert(ledgerEntries).values({
    id,
    code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
    propertyId: input.propertyId || null,
    direction: input.direction,
    category: input.category.trim(),
    description: input.description?.trim() ?? "",
    amount: input.amount,
    occurredAt,
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
