/**
 * Thao tác ghi.
 *
 * Mỗi hàm tự kiểm tra dữ liệu vào và trả về lỗi có thông điệp tiếng Việt để
 * route API chuyển thẳng ra giao diện. Thay đổi quan trọng được ghi `audit_logs`
 * theo yêu cầu ở docs/DATA-MODEL.md.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import type { BatchItem } from "drizzle-orm/batch";
import { isRealDate, nextCode, ValidationError, withCodeRetry, writeAudit } from "./internal";

import {
  bookingRequests,
  contractGuests,
  contracts,
  guests,
  ledgerEntries,
  properties,
  roomTypes,
  rooms,
} from "./schema";

import { getSettings } from "./settings";
export { ValidationError } from "./internal";

/* ------------------------------------------------------------------ */
/* Phòng                                                              */
/* ------------------------------------------------------------------ */

export type CreateRoomInput = {
  propertyId: string;
  roomTypeId: string;
  number: string;
  floor: number;
  price?: number | null;
  area?: number | null;
  note?: string;
  /** Người thao tác, ghi vào nhật ký. */
  actorId?: string | null;
};

export async function createRoom(input: CreateRoomInput) {
  const db = getDb();

  const number = input.number.trim();
  if (!number) throw new ValidationError("Cần nhập số phòng.", "number");
  if (!Number.isInteger(input.floor) || input.floor < 1) {
    throw new ValidationError("Tầng phải là số nguyên từ 1 trở lên.", "floor");
  }
  if (input.price != null && (!Number.isInteger(input.price) || input.price < 0)) {
    throw new ValidationError("Giá thuê phải là số nguyên VNĐ.", "price");
  }

  const [property] = await db
    .select({ id: properties.id, code: properties.code })
    .from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);
  if (!property) throw new ValidationError("Không tìm thấy nhà đã chọn.", "propertyId");

  const [roomType] = await db
    .select({ id: roomTypes.id, propertyId: roomTypes.propertyId })
    .from(roomTypes)
    .where(eq(roomTypes.id, input.roomTypeId))
    .limit(1);
  if (!roomType) throw new ValidationError("Không tìm thấy loại phòng.", "roomTypeId");
  if (roomType.propertyId !== property.id) {
    throw new ValidationError("Loại phòng không thuộc nhà đã chọn.", "roomTypeId");
  }

  const [existing] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.propertyId, property.id), eq(rooms.number, number)))
    .limit(1);
  if (existing) {
    throw new ValidationError(`Phòng ${number} đã tồn tại trong nhà này.`, "number");
  }

  const id = newId("rom");
  const [room] = await db
    .insert(rooms)
    .values({
      id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      code: `${property.code}-${number}`,
      number,
      floor: input.floor,
      price: input.price ?? null,
      area: input.area ?? null,
      note: input.note?.trim() ?? "",
    })
    .returning();

  await writeAudit(db, {
    actorId: input.actorId ?? null,
    action: "room.create",
    entityType: "room",
    entityId: id,
    changes: { code: room.code, number, floor: input.floor },
  });

  return room;
}

/* ------------------------------------------------------------------ */
/* Khách thuê + hợp đồng                                              */
/* ------------------------------------------------------------------ */

export type CreateTenantInput = {
  fullName: string;
  phone: string;
  idNumber?: string | null;
  dateOfBirth?: string | null;
  roomId: string;
  startDate: string;
  months?: number;
  rent?: number | null;
  deposit?: number | null;
  /** Bỏ trống thì lấy theo thiết lập `billing.defaultDay`. */
  billingDay?: number | null;
  /** Người thao tác, ghi vào nhật ký và sổ quỹ. */
  actorId?: string | null;
};

/**
 * Tạo hồ sơ khách và hợp đồng thuê trong cùng một thao tác.
 *
 * Chặn trường hợp hai người cùng được xếp vào một phòng: phòng đang có hợp đồng
 * hiệu lực thì từ chối ngay.
 */
export async function createTenant(input: CreateTenantInput) {
  const db = getDb();

  const fullName = input.fullName.trim();
  const phone = input.phone.replace(/\s+/g, "");
  if (!fullName) throw new ValidationError("Cần nhập họ tên khách thuê.", "fullName");
  if (!/^0\d{8,10}$/.test(phone)) {
    throw new ValidationError("Số điện thoại không hợp lệ.", "phone");
  }
  if (!isRealDate(input.startDate)) {
    throw new ValidationError("Ngày bắt đầu không hợp lệ.", "startDate");
  }

  const months = input.months ?? 12;
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new ValidationError("Thời hạn hợp đồng phải từ 1 đến 120 tháng.", "months");
  }

  const [room] = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      propertyId: rooms.propertyId,
      price: rooms.price,
      condition: rooms.condition,
      basePrice: roomTypes.basePrice,
    })
    .from(rooms)
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(eq(rooms.id, input.roomId))
    .limit(1);
  if (!room) throw new ValidationError("Không tìm thấy phòng đã chọn.", "roomId");
  if (room.condition !== "usable") {
    throw new ValidationError(`Phòng ${room.code} đang bảo trì, chưa cho thuê được.`, "roomId");
  }

  const [occupied] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.roomId, room.id), eq(contracts.status, "active")))
    .limit(1);
  if (occupied) {
    throw new ValidationError(`Phòng ${room.code} đang có hợp đồng hiệu lực.`, "roomId");
  }

  const rent = input.rent ?? room.price ?? room.basePrice;
  if (!Number.isInteger(rent) || rent <= 0) {
    throw new ValidationError("Giá thuê phải là số nguyên VNĐ lớn hơn 0.", "rent");
  }

  // Bỏ trống ô tiền cọc nghĩa là không thu cọc. Trước đây mặc định bằng tiền
  // thuê: xóa trắng ô đó là sổ quỹ ghi một khoản thu chưa từng có, rồi lúc trả
  // phòng lại "hoàn" khoản đó.
  const deposit = input.deposit ?? 0;
  if (!Number.isInteger(deposit) || deposit < 0) {
    throw new ValidationError("Tiền cọc phải là số nguyên VNĐ.", "deposit");
  }

  const configuredDay = Number((await getSettings())["billing.defaultDay"]);
  const billingDay =
    input.billingDay ?? (Number.isInteger(configuredDay) && configuredDay >= 1 ? configuredDay : 5);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    throw new ValidationError("Ngày thu phải nằm trong khoảng 1–28.", "billingDay");
  }

  const end = new Date(`${input.startDate}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + months);

  const guestId = newId("gst");
  const contractId = newId("ctr");
  const actorId = input.actorId ?? null;

  // Ghi cả hồ sơ, hợp đồng và khoản cọc trong MỘT lô. Ghi từng bước thì hỏng
  // giữa chừng để lại khách không có hợp đồng, hoặc hợp đồng không có dòng cọc
  // trong sổ quỹ. Trùng mã thì cả lô được làm lại với mã mới.
  await withCodeRetry(async () => {
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(guests).values({
        id: guestId,
        code: await nextCode(db, guests, guests.code, "KH"),
        fullName,
        phone,
        idNumber: input.idNumber?.trim() || null,
        dateOfBirth: input.dateOfBirth?.trim() || null,
      }),
      db.insert(contracts).values({
        id: contractId,
        code: await nextCode(db, contracts, contracts.code, "HD"),
        roomId: room.id,
        primaryGuestId: guestId,
        startDate: input.startDate,
        endDate: end.toISOString().slice(0, 10),
        rent,
        deposit,
        billingDay,
        status: "active",
        createdBy: actorId,
      }),
      db.insert(contractGuests).values({
        id: newId("cgu"),
        contractId,
        guestId,
        relationship: "Người đứng tên",
      }),
      // Giữ chỗ đã hoàn thành nhiệm vụ khi hợp đồng được ký. Không xóa ở đây
      // thì phòng sẽ hiện lại "Đã giữ" sau lúc hợp đồng kết thúc.
      db
        .update(bookingRequests)
        .set({ holdUntil: null, updatedAt: sql`(unixepoch() * 1000)` })
        .where(
          and(eq(bookingRequests.roomId, room.id), eq(bookingRequests.status, "confirmed")),
        ),
    ];

    // Ghi cọc vào sổ quỹ ngay khi thu. Không ghi thì lúc trả phòng khoản hoàn
    // cọc sẽ hiện thành lỗ, vì tiền vào chưa bao giờ được ghi nhận.
    if (deposit > 0) {
      statements.push(
        db.insert(ledgerEntries).values({
          id: newId("led"),
          code: await nextCode(db, ledgerEntries, ledgerEntries.code, "GD", 4),
          propertyId: room.propertyId,
          direction: "in",
          category: "Tiền cọc",
          description: `Cọc phòng ${room.code} · ${fullName}`,
          amount: deposit,
          occurredAt: input.startDate,
          recordedBy: actorId,
        }),
      );
    }

    await db.batch(statements);
  });

  await writeAudit(db, {
    actorId,
    action: "contract.create",
    entityType: "contract",
    entityId: contractId,
    changes: { room: room.code, guest: fullName, rent, deposit, startDate: input.startDate },
  });

  return { guestId, contractId };
}

export type UpdateTenantInput = {
  guestId: string;
  fullName?: string | null;
  phone?: string | null;
  /** Các trường dưới đây sửa hợp đồng ĐANG hiệu lực của khách. */
  rent?: number | null;
  billingDay?: number | null;
  /** `""` để bỏ ngày kết thúc (hợp đồng không thời hạn). */
  endDate?: string | null;
  actorId: string;
};

/**
 * Sửa hồ sơ khách và hợp đồng đang hiệu lực.
 *
 * Trước đây nhập sai giá thuê, số điện thoại hay ngày thu là không sửa được,
 * và hợp đồng hết hạn cũng không gia hạn được. Chỉ sửa những gì áp dụng cho
 * tương lai: đơn đã lập giữ nguyên số tiền lúc lập, tiền cọc đã thu không đổi
 * ở đây vì nó gắn với một dòng sổ quỹ.
 */
export async function updateTenant(input: UpdateTenantInput) {
  const db = getDb();

  const [guest] = await db
    .select({ id: guests.id, fullName: guests.fullName, phone: guests.phone })
    .from(guests)
    .where(eq(guests.id, input.guestId))
    .limit(1);
  if (!guest) throw new ValidationError("Không tìm thấy khách thuê.", "guestId");

  const changes: Record<string, unknown> = {};
  const guestPatch: Partial<typeof guests.$inferInsert> = {};

  if (input.fullName != null) {
    const fullName = input.fullName.trim();
    if (!fullName) throw new ValidationError("Cần nhập họ tên khách thuê.", "fullName");
    if (fullName.length > 120) throw new ValidationError("Họ tên quá dài.", "fullName");
    if (fullName !== guest.fullName) {
      guestPatch.fullName = fullName;
      changes.fullName = { from: guest.fullName, to: fullName };
    }
  }
  if (input.phone != null) {
    const phone = input.phone.replace(/\s+/g, "");
    if (!/^0\d{8,10}$/.test(phone)) {
      throw new ValidationError("Số điện thoại không hợp lệ.", "phone");
    }
    if (phone !== guest.phone) {
      guestPatch.phone = phone;
      changes.phone = { from: guest.phone, to: phone };
    }
  }

  const touchesContract =
    input.rent != null || input.billingDay != null || input.endDate != null;
  const contractPatch: Partial<typeof contracts.$inferInsert> = {};
  let contractId: string | null = null;

  if (touchesContract) {
    const [contract] = await db
      .select({
        id: contracts.id,
        rent: contracts.rent,
        billingDay: contracts.billingDay,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
      })
      .from(contracts)
      .where(and(eq(contracts.primaryGuestId, guest.id), eq(contracts.status, "active")))
      .limit(1);
    if (!contract) {
      throw new ValidationError("Khách này không còn hợp đồng hiệu lực để sửa.", "guestId");
    }
    contractId = contract.id;

    if (input.rent != null && input.rent !== contract.rent) {
      if (!Number.isInteger(input.rent) || input.rent <= 0) {
        throw new ValidationError("Giá thuê phải là số nguyên VNĐ lớn hơn 0.", "rent");
      }
      contractPatch.rent = input.rent;
      changes.rent = { from: contract.rent, to: input.rent };
    }
    if (input.billingDay != null && input.billingDay !== contract.billingDay) {
      if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 28) {
        throw new ValidationError("Ngày thu phải nằm trong khoảng 1–28.", "billingDay");
      }
      contractPatch.billingDay = input.billingDay;
      changes.billingDay = { from: contract.billingDay, to: input.billingDay };
    }
    if (input.endDate != null) {
      const endDate = input.endDate === "" ? null : input.endDate;
      if (endDate !== null) {
        if (!isRealDate(endDate)) {
          throw new ValidationError("Ngày kết thúc không hợp lệ.", "endDate");
        }
        if (endDate < contract.startDate) {
          throw new ValidationError(
            "Ngày kết thúc không được trước ngày bắt đầu hợp đồng.",
            "endDate",
          );
        }
      }
      if (endDate !== contract.endDate) {
        contractPatch.endDate = endDate;
        changes.endDate = { from: contract.endDate, to: endDate };
      }
    }
  }

  if (Object.keys(guestPatch).length > 0) {
    await db
      .update(guests)
      .set({ ...guestPatch, updatedAt: sql`(unixepoch() * 1000)` })
      .where(eq(guests.id, guest.id));
  }
  if (contractId && Object.keys(contractPatch).length > 0) {
    await db
      .update(contracts)
      .set({ ...contractPatch, updatedAt: sql`(unixepoch() * 1000)` })
      .where(and(eq(contracts.id, contractId), eq(contracts.status, "active")));
  }

  if (Object.keys(changes).length > 0) {
    await writeAudit(db, {
      actorId: input.actorId,
      action: "tenant.update",
      entityType: "guest",
      entityId: guest.id,
      changes,
    });
  }

  return { ok: true, changed: Object.keys(changes) };
}

/** Đổi tình trạng vật lý của phòng (dùng cho nút bảo trì). */
export async function setRoomCondition(roomId: string, condition: "usable" | "maintenance") {
  const db = getDb();
  const [room] = await db
    .update(rooms)
    .set({ condition, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(rooms.id, roomId))
    .returning();
  if (!room) throw new ValidationError("Không tìm thấy phòng.", "roomId");

  await writeAudit(db, {
    action: "room.condition",
    entityType: "room",
    entityId: roomId,
    changes: { condition },
  });

  return room;
}

/* ------------------------------------------------------------------ */
/* Nhà và loại phòng                                                  */
/* ------------------------------------------------------------------ */

export type CreatePropertyInput = {
  name: string;
  code: string;
  address?: string;
  /** Loại phòng tạo kèm; để trống thì dùng ba loại mặc định. */
  roomTypes?: Array<{ name: string; basePrice: number; area?: number; maxOccupants?: number }>;
};

const DEFAULT_ROOM_TYPES = [
  { name: "Studio", basePrice: 3_400_000, area: 22, maxOccupants: 2 },
  { name: "Gác lửng", basePrice: 3_800_000, area: 28, maxOccupants: 3 },
  { name: "Ban công", basePrice: 4_200_000, area: 24, maxOccupants: 2 },
];

/**
 * Thêm một nhà trọ mới kèm danh mục loại phòng ban đầu.
 *
 * Nhà không có loại phòng nào thì không thêm phòng được, nên luôn tạo sẵn ít
 * nhất một loại.
 */
export async function createProperty(input: CreatePropertyInput) {
  const db = getDb();

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();

  if (!name) throw new ValidationError("Cần nhập tên nhà.", "name");
  if (!/^[A-Z0-9]{2,6}$/.test(code)) {
    throw new ValidationError("Mã nhà gồm 2–6 chữ cái hoặc số, ví dụ AP.", "code");
  }

  const [existing] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.code, code))
    .limit(1);
  if (existing) throw new ValidationError(`Mã nhà ${code} đã được dùng.`, "code");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(properties);

  const propertyId = newId("prp");
  await db.insert(properties).values({
    id: propertyId,
    name,
    code,
    address: input.address?.trim() ?? "",
    sortOrder: Number(count ?? 0),
  });

  const templates = input.roomTypes?.length ? input.roomTypes : DEFAULT_ROOM_TYPES;
  for (const template of templates) {
    if (!template.name?.trim()) {
      throw new ValidationError("Loại phòng phải có tên.", "roomTypes");
    }
    if (!Number.isInteger(template.basePrice) || template.basePrice <= 0) {
      throw new ValidationError(
        `Giá niêm yết của loại "${template.name}" phải là số nguyên VNĐ lớn hơn 0.`,
        "roomTypes",
      );
    }
  }

  await db.insert(roomTypes).values(
    templates.map((template) => ({
      id: newId("rmt"),
      propertyId,
      name: template.name.trim(),
      basePrice: template.basePrice,
      area: template.area ?? 0,
      maxOccupants: template.maxOccupants ?? 2,
      description: "",
    })),
  );

  await writeAudit(db, {
    action: "property.create",
    entityType: "property",
    entityId: propertyId,
    changes: { name, code, roomTypes: templates.length },
  });

  return { id: propertyId, name, code };
}

export type CreateRoomTypeInput = {
  propertyId: string;
  name: string;
  basePrice: number;
  area?: number;
  maxOccupants?: number;
  amenities?: string[];
};

export async function createRoomType(input: CreateRoomTypeInput) {
  const db = getDb();

  const name = input.name.trim();
  if (!name) throw new ValidationError("Cần nhập tên loại phòng.", "name");
  if (!Number.isInteger(input.basePrice) || input.basePrice <= 0) {
    throw new ValidationError("Giá niêm yết phải là số nguyên VNĐ lớn hơn 0.", "basePrice");
  }

  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);
  if (!property) throw new ValidationError("Không tìm thấy nhà đã chọn.", "propertyId");

  const [duplicate] = await db
    .select({ id: roomTypes.id })
    .from(roomTypes)
    .where(and(eq(roomTypes.propertyId, property.id), eq(roomTypes.name, name)))
    .limit(1);
  if (duplicate) {
    throw new ValidationError(`Nhà này đã có loại phòng "${name}".`, "name");
  }

  const id = newId("rmt");
  await db.insert(roomTypes).values({
    id,
    propertyId: property.id,
    name,
    basePrice: input.basePrice,
    area: input.area ?? 0,
    maxOccupants: input.maxOccupants ?? 2,
    amenities: input.amenities ?? [],
    description: "",
  });

  await writeAudit(db, {
    action: "roomType.create",
    entityType: "room_type",
    entityId: id,
    changes: { name, basePrice: input.basePrice },
  });

  return { id, name };
}
