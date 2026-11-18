/**
 * Trả phòng: kết thúc hợp đồng và tất toán tiền cọc.
 *
 * Dòng tiền của cọc được ghi ở hai đầu:
 *
 * - Lúc ký hợp đồng, cọc vào sổ quỹ là khoản thu (`db/mutations.ts`).
 * - Lúc trả phòng, phần hoàn lại ra sổ quỹ là khoản chi.
 *
 * Phần cọc dùng để cấn nợ hoặc bị khấu trừ thì KHÔNG ghi sổ lần nữa: tiền mặt
 * đó đã vào từ lúc thu cọc, ghi thêm là đếm hai lần. Nhờ cách này số dư sổ quỹ
 * khớp với tiền thật trong két.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordPayment } from "./finance";
import { getDb } from "./index";
import { newId } from "./ids";
import { ISO_DATE, nextCode, ValidationError, withCodeRetry, writeAudit } from "./internal";
import { contracts, guests, invoices, ledgerEntries, properties, rooms } from "./schema";

export type MoveOutPreview = {
  contractId: string;
  contractCode: string;
  roomId: string;
  roomCode: string;
  propertyName: string;
  tenantName: string;
  tenantPhone: string;
  startDate: string;
  deposit: number;
  /** Tổng còn nợ của các đơn chưa thu đủ. */
  outstanding: number;
  unpaidInvoices: Array<{
    id: string;
    code: string;
    period: string;
    dueDate: string;
    remaining: number;
  }>;
};

/** Các đơn chưa thu đủ của một hợp đồng, cũ trước — trả nợ theo thứ tự đó. */
async function listUnpaidInvoices(db: ReturnType<typeof getDb>, contractId: string) {
  const unpaid = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      period: invoices.period,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.contractId, contractId),
        inArray(invoices.status, ["issued", "partial"]),
      ),
    )
    .orderBy(asc(invoices.dueDate));

  return unpaid.map((invoice) => ({
    id: invoice.id,
    code: invoice.code,
    period: invoice.period,
    dueDate: invoice.dueDate,
    remaining: invoice.total - invoice.paidAmount,
  }));
}

export async function moveOutPreview(contractId: string): Promise<MoveOutPreview> {
  const db = getDb();

  const [contract] = await db
    .select({
      id: contracts.id,
      code: contracts.code,
      status: contracts.status,
      startDate: contracts.startDate,
      deposit: contracts.deposit,
      roomId: rooms.id,
      roomCode: rooms.code,
      propertyName: properties.name,
      tenantName: guests.fullName,
      tenantPhone: guests.phone,
    })
    .from(contracts)
    .innerJoin(rooms, eq(rooms.id, contracts.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .where(eq(contracts.id, contractId))
    .limit(1);

  if (!contract) throw new ValidationError("Không tìm thấy hợp đồng.", "contractId");
  if (contract.status !== "active") {
    throw new ValidationError("Hợp đồng này đã kết thúc rồi.", "contractId");
  }

  const unpaidInvoices = await listUnpaidInvoices(db, contractId);

  return {
    contractId: contract.id,
    contractCode: contract.code,
    roomId: contract.roomId,
    roomCode: contract.roomCode,
    propertyName: contract.propertyName,
    tenantName: contract.tenantName,
    tenantPhone: contract.tenantPhone,
    startDate: contract.startDate,
    deposit: contract.deposit,
    outstanding: unpaidInvoices.reduce((sum, invoice) => sum + invoice.remaining, 0),
    unpaidInvoices,
  };
}

export type MoveOutInput = {
  contractId: string;
  endDate: string;
  reason?: string;
  /** Khấu trừ hư hỏng, vệ sinh... trừ vào phần cọc còn lại. */
  deductions?: number;
  deductionNote?: string;
  actorId: string;
};

export type MoveOutResult = {
  /** Phần cọc đã cấn vào các đơn còn nợ. */
  settledFromDeposit: number;
  /** Phần cọc chủ nhà giữ lại do khấu trừ. */
  deductionKept: number;
  /** Phần cọc hoàn lại cho khách. */
  refund: number;
  /** Khách vẫn còn nợ sau khi cấn hết cọc. */
  stillOwed: number;
};

/**
 * Kết thúc hợp đồng và tất toán.
 *
 * Thứ tự cấn trừ: nợ đơn thu trước, rồi mới tới khấu trừ hư hỏng. Còn lại bao
 * nhiêu thì hoàn cho khách. Nếu cọc không đủ, phần thiếu vẫn nằm nguyên ở các
 * đơn chưa thu — không tự xóa nợ, vì đó là tiền chủ nhà vẫn có quyền đòi.
 *
 * Việc ĐẦU TIÊN là giành hợp đồng bằng một câu UPDATE có điều kiện
 * `status = 'active'`. Cọc chỉ được tiêu sau khi giành được, nên:
 *
 * - hai yêu cầu song song không thể cùng hoàn cọc — chỉ một câu đổi được dòng;
 * - thử lại sau khi hỏng giữa chừng không tính lại từ nguyên số cọc, vì hợp
 *   đồng đã đóng. Trước đây hợp đồng chỉ đóng ở bước cuối, nên một lần hỏng
 *   rồi thử lại cấn được nhiều hơn số cọc thật.
 *
 * Sau khi giành được, hợp đồng KHÔNG bao giờ được mở lại một khi đã thử ghi
 * bất kỳ khoản nào: một lệnh ghi báo lỗi vẫn có thể đã ghi xong (mất phản hồi),
 * mở lại là mời tính lại từ nguyên số cọc. Hỏng giữa chừng thì hợp đồng vẫn
 * đóng, phần đã làm được ghi vào nhật ký và báo rõ để xử lý tay phần còn lại.
 */
export async function endContract(input: MoveOutInput): Promise<MoveOutResult> {
  const db = getDb();

  if (!ISO_DATE.test(input.endDate)) {
    throw new ValidationError("Ngày trả phòng không hợp lệ.", "endDate");
  }

  const preview = await moveOutPreview(input.contractId);

  if (input.endDate < preview.startDate) {
    throw new ValidationError(
      `Ngày trả phòng không được trước ngày bắt đầu hợp đồng (${preview.startDate}).`,
      "endDate",
    );
  }

  const deductions = input.deductions ?? 0;
  if (!Number.isInteger(deductions) || deductions < 0) {
    throw new ValidationError("Khoản khấu trừ phải là số nguyên VNĐ.", "deductions");
  }

  const [room] = await db
    .select({ propertyId: rooms.propertyId })
    .from(rooms)
    .where(eq(rooms.id, preview.roomId))
    .limit(1);

  const reason = [input.reason?.trim(), input.deductionNote?.trim()]
    .filter(Boolean)
    .join(" — ");

  // 0. Giành hợp đồng trước khi đụng tới tiền cọc.
  const [claimed] = await db
    .update(contracts)
    .set({
      status: "ended",
      endedAt: input.endDate,
      endReason: reason,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(and(eq(contracts.id, input.contractId), eq(contracts.status, "active")))
    .returning({ id: contracts.id });

  if (!claimed) {
    throw new ValidationError("Hợp đồng này đã kết thúc rồi.", "contractId");
  }

  let remainingDeposit = preview.deposit;
  let settledFromDeposit = 0;
  let deductionKept = 0;
  let refund = 0;
  /** Đã thử ghi tiền chưa. Từ lúc này không còn được mở lại hợp đồng. */
  let moneyTouched = false;
  let outstanding = preview.outstanding;

  try {
    // Đọc lại nợ SAU khi giành hợp đồng: số ở bản xem trước có thể đã cũ nếu
    // vừa có khoản thu thường vào một trong các đơn.
    const unpaidNow = await listUnpaidInvoices(db, input.contractId);
    outstanding = unpaidNow.reduce((sum, invoice) => sum + invoice.remaining, 0);

    // 1. Cấn cọc vào các đơn còn nợ, cũ trước mới sau.
    for (const invoice of unpaidNow) {
      if (remainingDeposit <= 0) break;
      const amount = Math.min(remainingDeposit, invoice.remaining);
      if (amount <= 0) continue;

      moneyTouched = true;
      try {
        await recordPayment({
          invoiceId: invoice.id,
          amount,
          method: "other",
          paidAt: input.endDate,
          note: `Cấn trừ tiền cọc khi trả phòng ${preview.roomCode}`,
          actorId: input.actorId,
          // Tiền đã vào sổ từ lúc thu cọc; ghi lại lần nữa là đếm hai lần.
          skipLedger: true,
        });
      } catch (error) {
        // ValidationError là từ chối sạch, chưa ghi gì: đơn vừa được thu hoặc
        // hủy ở thao tác khác. Bỏ qua đơn đó, cọc còn nguyên cho các bước sau.
        if (error instanceof ValidationError) continue;
        throw error;
      }

      remainingDeposit -= amount;
      settledFromDeposit += amount;
    }

    // 2. Khấu trừ hư hỏng, lấy từ phần cọc còn lại.
    deductionKept = Math.min(deductions, remainingDeposit);
    remainingDeposit -= deductionKept;

    // 3. Phần còn lại hoàn cho khách, ghi sổ quỹ là khoản chi.
    if (remainingDeposit > 0) {
      const amount = remainingDeposit;
      moneyTouched = true;
      await withCodeRetry(async () =>
        db.insert(ledgerEntries).values({
          id: newId("led"),
          code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
          propertyId: room?.propertyId ?? null,
          direction: "out",
          category: "Hoàn cọc",
          description: `Hoàn cọc phòng ${preview.roomCode} · ${preview.tenantName}`,
          amount,
          occurredAt: input.endDate,
          recordedBy: input.actorId,
        }),
      );
      refund = amount;
    }
  } catch (error) {
    console.error("[tra-phong-do-dang]", preview.contractCode, error);

    if (!moneyTouched) {
      // Chưa thử ghi đồng nào: mở lại hợp đồng để làm lại từ đầu là an toàn.
      let reopened = false;
      try {
        await db
          .update(contracts)
          .set({
            status: "active",
            endedAt: null,
            endReason: "",
            updatedAt: sql`(unixepoch() * 1000)`,
          })
          .where(and(eq(contracts.id, input.contractId), eq(contracts.status, "ended")));
        reopened = true;
      } catch (reopenError) {
        // Không mở lại được (ví dụ phòng vừa có hợp đồng mới): hợp đồng đóng,
        // cọc chưa đụng tới — báo rõ ở dưới thay vì để lỗi này che lỗi gốc.
        console.error("[tra-phong-khong-mo-lai-duoc]", preview.contractCode, reopenError);
      }
      if (reopened) throw error;
    }

    try {
      await writeAudit(db, {
        actorId: input.actorId,
        action: "contract.end.incomplete",
        entityType: "contract",
        entityId: input.contractId,
        changes: {
          room: preview.roomCode,
          tenant: preview.tenantName,
          endDate: input.endDate,
          deposit: preview.deposit,
          settledFromDeposit,
        },
      });
    } catch (auditError) {
      console.error("[nhat-ky-tra-phong]", preview.contractCode, auditError);
    }

    throw new ValidationError(
      `Hợp đồng ${preview.contractCode} đã đóng nhưng tất toán cọc chưa xong. Đã cấn chắc chắn ` +
        `${settledFromDeposit.toLocaleString("vi-VN")}đ trên ${preview.deposit.toLocaleString("vi-VN")}đ ` +
        "tiền cọc vào đơn nợ; bước tiếp theo bị lỗi nên có thể đã ghi hoặc chưa. " +
        "Kiểm tra các đơn của khách và sổ thu chi (nhóm Hoàn cọc), rồi ghi tay phần còn thiếu.",
      "contractId",
    );
  }

  const stillOwed = Math.max(outstanding - settledFromDeposit, 0);

  await writeAudit(db, {
    actorId: input.actorId,
    action: "contract.end",
    entityType: "contract",
    entityId: input.contractId,
    changes: {
      room: preview.roomCode,
      tenant: preview.tenantName,
      endDate: input.endDate,
      deposit: preview.deposit,
      settledFromDeposit,
      deductionKept,
      refund,
      stillOwed,
    },
  });

  return { settledFromDeposit, deductionKept, refund, stillOwed };
}
