/**
 * Hủy đơn thu.
 *
 * Đơn không bị xóa cứng — `docs/DATA-MODEL.md` quy định giữ lại để truy vết ai
 * đã lập và ai đã hủy. Đơn hủy vẫn hiện trong danh sách với nhãn riêng, nhưng
 * không còn tính vào doanh thu hay công nợ.
 *
 * Ràng buộc UNIQUE `(contract_id, period)` là index một phần bỏ qua đơn đã hủy,
 * nên hủy xong lập lại được cho đúng kỳ đó.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import { ValidationError, writeAudit } from "./internal";
import { invoiceItems, invoices } from "./schema";

export type CancelResult = {
  code: string;
  /** Số dòng đã bỏ tham chiếu tới bản ghi chỉ số điện. */
  detachedReadings: number;
};

export async function cancelInvoice(input: {
  invoiceId: string;
  reason: string;
  actorId: string;
}): Promise<CancelResult> {
  const db = getDb();

  const reason = input.reason.trim();
  if (!reason) {
    throw new ValidationError("Cần ghi lý do hủy để sau này còn tra được.", "reason");
  }

  const [invoice] = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      status: invoices.status,
      paidAmount: invoices.paidAmount,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId))
    .limit(1);

  if (!invoice) throw new ValidationError("Không tìm thấy đơn thu.", "invoiceId");
  if (invoice.status === "cancelled") {
    throw new ValidationError("Đơn này đã hủy rồi.", "invoiceId");
  }

  // Đơn đã thu tiền thì hủy sẽ để lại khoản thanh toán treo không thuộc đơn nào.
  // Phải xử lý tiền trước; hệ thống chưa có chức năng hoàn tiền nên chặn tại đây.
  if (invoice.paidAmount > 0) {
    throw new ValidationError(
      `Đơn ${invoice.code} đã thu ${invoice.paidAmount.toLocaleString("vi-VN")}đ. Hoàn tiền cho khách trước rồi mới hủy được.`,
      "invoiceId",
    );
  }

  // Bỏ tham chiếu chỉ số điện, nhưng GIỮ lại bản ghi chỉ số.
  //
  // Xóa hẳn thì mốc chỉ số đầu kỳ biến mất: lập lại cùng kỳ sẽ tính từ 0 và ra
  // một hóa đơn điện khổng lồ. Giữ lại thì `billingPreview` vẫn lấy đúng chỉ số
  // của kỳ trước, còn lần lập lại sẽ ghi đè bản ghi của chính kỳ này.
  const items = await db
    .select({ id: invoiceItems.id, meterReadingId: invoiceItems.meterReadingId })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoice.id));

  const detached = items.filter((item) => item.meterReadingId).length;
  if (detached > 0) {
    await db
      .update(invoiceItems)
      .set({ meterReadingId: null })
      .where(eq(invoiceItems.invoiceId, invoice.id));
  }

  await db
    .update(invoices)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: input.actorId,
      cancelReason: reason,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.status, invoice.status)));

  await writeAudit(db, {
    actorId: input.actorId,
    action: "invoice.cancel",
    entityType: "invoice",
    entityId: invoice.id,
    changes: { code: invoice.code, reason, detachedReadings: detached },
  });

  return { code: invoice.code, detachedReadings: detached };
}
