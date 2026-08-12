/** Yêu cầu đặt phòng: nhận từ trang công khai và xử lý ở trang quản trị. */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { ISO_DATE, nextCode, ValidationError, writeAudit } from "./internal";
import { bookingRequests, contracts, rooms } from "./schema";

export type BookingStatusValue = "new" | "contacted" | "confirmed" | "rejected";

export type BookingRequestInput = {
  fullName: string;
  phone: string;
  email?: string | null;
  roomId?: string | null;
  preferredMoveIn?: string | null;
  occupants?: number;
  message?: string;
};

/**
 * Nhận yêu cầu từ trang công khai.
 *
 * Không tin giá trị nào từ biểu mẫu công khai: `roomId` được tra lại trong cơ
 * sở dữ liệu để lấy nhà và loại phòng, và trạng thái luôn bắt đầu ở "new" —
 * khách không tự giữ được phòng, chủ nhà phải xác nhận.
 */
export async function createBookingRequest(input: BookingRequestInput) {
  const db = getDb();

  const fullName = input.fullName.trim();
  const phone = input.phone.replace(/\s+/g, "");
  if (!fullName) throw new ValidationError("Cần nhập họ tên.", "fullName");
  if (!/^0\d{8,10}$/.test(phone)) {
    throw new ValidationError("Số điện thoại không hợp lệ.", "phone");
  }
  if (input.preferredMoveIn && !ISO_DATE.test(input.preferredMoveIn)) {
    throw new ValidationError("Ngày muốn xem phòng không hợp lệ.", "preferredMoveIn");
  }

  let propertyId: string | null = null;
  let roomTypeId: string | null = null;
  let roomId: string | null = null;

  if (input.roomId) {
    const [room] = await db
      .select({ id: rooms.id, propertyId: rooms.propertyId, roomTypeId: rooms.roomTypeId })
      .from(rooms)
      .where(eq(rooms.id, input.roomId))
      .limit(1);
    if (!room) throw new ValidationError("Phòng không còn khả dụng.", "roomId");
    roomId = room.id;
    propertyId = room.propertyId;
    roomTypeId = room.roomTypeId;
  }

  const id = newId("bkg");
  await db.insert(bookingRequests).values({
    id,
    code: await nextCode(db, bookingRequests, bookingRequests.code, "DP"),
    fullName,
    phone,
    email: input.email?.trim() || null,
    propertyId,
    roomTypeId,
    roomId,
    preferredMoveIn: input.preferredMoveIn ?? null,
    occupants: Math.min(Math.max(input.occupants ?? 1, 1), 10),
    // Cắt độ dài để biểu mẫu công khai không nhồi được dữ liệu lớn vào CSDL.
    message: (input.message ?? "").slice(0, 1000),
    status: "new",
  });

  return { id };
}

/**
 * Đổi trạng thái yêu cầu.
 *
 * Khi xác nhận thì phòng được giữ tới `holdUntil`; trạng thái "Đã giữ" của phòng
 * suy ra từ đây. Không cho xác nhận phòng đã có hợp đồng, đang bảo trì, hoặc
 * đang được yêu cầu khác giữ — đây là chỗ chặn hai khách cùng nhận một phòng.
 */
export async function setBookingStatus(
  bookingId: string,
  status: BookingStatusValue,
  actorId: string,
  holdDays = 3,
) {
  const db = getDb();

  const [booking] = await db
    .select()
    .from(bookingRequests)
    .where(eq(bookingRequests.id, bookingId))
    .limit(1);
  if (!booking) throw new ValidationError("Không tìm thấy yêu cầu đặt phòng.", "bookingId");

  let holdUntil: Date | null = null;

  if (status === "confirmed") {
    if (!booking.roomId) {
      throw new ValidationError(
        "Yêu cầu này chưa gắn với phòng cụ thể nên chưa giữ chỗ được.",
        "roomId",
      );
    }

    const [room] = await db
      .select({ code: rooms.code, condition: rooms.condition })
      .from(rooms)
      .where(eq(rooms.id, booking.roomId))
      .limit(1);
    if (!room) throw new ValidationError("Phòng không còn tồn tại.", "roomId");
    if (room.condition !== "usable") {
      throw new ValidationError(`Phòng ${room.code} đang bảo trì.`, "roomId");
    }

    const [occupied] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.roomId, booking.roomId), eq(contracts.status, "active")))
      .limit(1);
    if (occupied) {
      throw new ValidationError(`Phòng ${room.code} đang có hợp đồng hiệu lực.`, "roomId");
    }

    const [heldByOther] = await db
      .select({ code: bookingRequests.code })
      .from(bookingRequests)
      .where(
        and(
          eq(bookingRequests.roomId, booking.roomId),
          eq(bookingRequests.status, "confirmed"),
          gt(bookingRequests.holdUntil, new Date()),
          ne(bookingRequests.id, bookingId),
        ),
      )
      .limit(1);
    if (heldByOther) {
      throw new ValidationError(
        `Phòng ${room.code} đang được giữ cho yêu cầu ${heldByOther.code}.`,
        "roomId",
      );
    }

    holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
  }

  const [updated] = await db
    .update(bookingRequests)
    .set({ status, holdUntil, handledBy: actorId, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(bookingRequests.id, bookingId))
    .returning();

  await writeAudit(db, {
    actorId,
    action: "booking.status",
    entityType: "booking_request",
    entityId: bookingId,
    changes: { from: booking.status, to: status },
  });

  return updated;
}
