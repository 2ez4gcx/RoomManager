/**
 * Truy vấn đọc dùng cho các trang quản trị.
 *
 * Trạng thái phòng KHÔNG lưu trong bảng `rooms` mà suy ra tại đây từ ba nguồn:
 * tình trạng vật lý, hợp đồng còn hiệu lực và yêu cầu giữ chỗ chưa hết hạn.
 * Nhờ vậy không có chuyện phòng vừa "trống" vừa có hợp đồng đang chạy.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  bookingRequests,
  contracts,
  guests,
  invoices,
  ledgerEntries,
  properties,
  roomTypes,
  rooms,
} from "./schema";

export type RoomStatus = "Đang thuê" | "Trống" | "Đã giữ" | "Bảo trì";

export type RoomView = {
  id: string;
  code: string;
  number: string;
  floor: number;
  area: number;
  price: number;
  propertyId: string;
  propertyName: string;
  roomTypeName: string;
  status: RoomStatus;
  tenantId: string | null;
  tenantName: string | null;
  contractId: string | null;
  /** Hạn thanh toán gần nhất còn nợ, dạng `YYYY-MM-DD`. */
  dueDate: string | null;
  outstanding: number;
  note: string;
};

/** Id các phòng đang được giữ chỗ và chưa hết hạn giữ. */
async function heldRoomIds(db: ReturnType<typeof getDb>) {
  const held = await db
    .select({ roomId: bookingRequests.roomId })
    .from(bookingRequests)
    .where(
      and(
        eq(bookingRequests.status, "confirmed"),
        gt(bookingRequests.holdUntil, new Date()),
      ),
    );

  return new Set(held.map((row) => row.roomId).filter((id): id is string => Boolean(id)));
}

/** Công nợ và hạn gần nhất của từng hợp đồng, gộp sẵn để không truy vấn theo vòng lặp. */
async function outstandingByContract(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select({
      contractId: invoices.contractId,
      outstanding: sql<number>`sum(${invoices.total} - ${invoices.paidAmount})`,
      dueDate: sql<string>`min(${invoices.dueDate})`,
    })
    .from(invoices)
    .where(inArray(invoices.status, ["issued", "partial"]))
    .groupBy(invoices.contractId);

  return new Map(rows.map((row) => [row.contractId, row]));
}

export async function listRooms(): Promise<RoomView[]> {
  const db = getDb();
  const [held, outstanding] = await Promise.all([
    heldRoomIds(db),
    outstandingByContract(db),
  ]);

  const rows = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      number: rooms.number,
      floor: rooms.floor,
      area: rooms.area,
      price: rooms.price,
      condition: rooms.condition,
      note: rooms.note,
      propertyId: properties.id,
      propertyName: properties.name,
      propertySort: properties.sortOrder,
      roomTypeName: roomTypes.name,
      basePrice: roomTypes.basePrice,
      baseArea: roomTypes.area,
      contractId: contracts.id,
      tenantId: guests.id,
      tenantName: guests.fullName,
    })
    .from(rooms)
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .leftJoin(
      contracts,
      and(eq(contracts.roomId, rooms.id), eq(contracts.status, "active")),
    )
    .leftJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .orderBy(properties.sortOrder, rooms.number);

  return rows.map((row) => {
    const debt = row.contractId ? outstanding.get(row.contractId) : undefined;
    const status: RoomStatus =
      row.condition === "maintenance"
        ? "Bảo trì"
        : row.contractId
          ? "Đang thuê"
          : held.has(row.id)
            ? "Đã giữ"
            : "Trống";

    return {
      id: row.id,
      code: row.code,
      number: row.number,
      floor: row.floor,
      area: row.area ?? row.baseArea,
      price: row.price ?? row.basePrice,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      roomTypeName: row.roomTypeName,
      status,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      contractId: row.contractId,
      dueDate: debt?.dueDate ?? null,
      outstanding: Number(debt?.outstanding ?? 0),
      note: row.note,
    };
  });
}

export type TenantView = {
  guestId: string;
  code: string;
  fullName: string;
  phone: string;
  contractId: string | null;
  roomCode: string | null;
  propertyName: string | null;
  startDate: string | null;
  endDate: string | null;
  rent: number;
  debt: number;
  status: "Đang thuê" | "Sắp hết hạn" | "Chậm thanh toán" | "Đã trả phòng";
};

const EXPIRING_SOON_DAYS = 30;

export async function listTenants(): Promise<TenantView[]> {
  const db = getDb();
  const outstanding = await outstandingByContract(db);

  const rows = await db
    .select({
      guestId: guests.id,
      code: guests.code,
      fullName: guests.fullName,
      phone: guests.phone,
      contractId: contracts.id,
      contractStatus: contracts.status,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      rent: contracts.rent,
      roomCode: rooms.code,
      propertyName: properties.name,
    })
    .from(guests)
    .leftJoin(
      contracts,
      and(eq(contracts.primaryGuestId, guests.id), eq(contracts.status, "active")),
    )
    .leftJoin(rooms, eq(rooms.id, contracts.roomId))
    .leftJoin(properties, eq(properties.id, rooms.propertyId))
    .orderBy(guests.code);

  const today = new Date();

  return rows.map((row) => {
    const debt = Number(
      (row.contractId ? outstanding.get(row.contractId)?.outstanding : 0) ?? 0,
    );
    const daysLeft = row.endDate
      ? Math.ceil((new Date(row.endDate).getTime() - today.getTime()) / 86_400_000)
      : null;

    const status: TenantView["status"] = !row.contractId
      ? "Đã trả phòng"
      : debt > 0
        ? "Chậm thanh toán"
        : daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS
          ? "Sắp hết hạn"
          : "Đang thuê";

    return {
      guestId: row.guestId,
      code: row.code,
      fullName: row.fullName,
      phone: row.phone,
      contractId: row.contractId,
      roomCode: row.roomCode,
      propertyName: row.propertyName,
      startDate: row.startDate,
      endDate: row.endDate,
      rent: row.rent ?? 0,
      debt,
      status,
    };
  });
}

export type PropertyOption = {
  id: string;
  name: string;
  code: string;
  address: string;
};

export async function listProperties(): Promise<PropertyOption[]> {
  const db = getDb();
  return db
    .select({
      id: properties.id,
      name: properties.name,
      code: properties.code,
      address: properties.address,
    })
    .from(properties)
    .where(eq(properties.isActive, true))
    .orderBy(properties.sortOrder);
}

export type RoomTypeOption = {
  id: string;
  propertyId: string;
  name: string;
  basePrice: number;
  area: number;
};

export async function listRoomTypes(): Promise<RoomTypeOption[]> {
  const db = getDb();
  return db
    .select({
      id: roomTypes.id,
      propertyId: roomTypes.propertyId,
      name: roomTypes.name,
      basePrice: roomTypes.basePrice,
      area: roomTypes.area,
    })
    .from(roomTypes)
    .orderBy(roomTypes.name);
}

export type DashboardSummary = {
  totalRooms: number;
  occupiedRooms: number;
  vacantRooms: number;
  heldRooms: number;
  maintenanceRooms: number;
  occupancyRate: number;
  /** Đã thu trong kỳ hiện tại. */
  collected: number;
  /** Tổng phát hành trong kỳ hiện tại. */
  billed: number;
  outstanding: number;
  overdueInvoices: number;
  newBookings: number;
  expiringContracts: number;
  byProperty: Array<{
    id: string;
    name: string;
    total: number;
    occupied: number;
    rate: number;
  }>;
};

export async function dashboardSummary(): Promise<DashboardSummary> {
  const db = getDb();
  const period = new Date().toISOString().slice(0, 7);
  const todayIso = new Date().toISOString().slice(0, 10);

  const roomViews = await listRooms();

  const [[periodTotals], [newBookingRow], [expiringRow], [overdueRow]] = await Promise.all([
    db
      .select({
        billed: sql<number>`coalesce(sum(${invoices.total}), 0)`,
        collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.period, period), inArray(invoices.status, ["issued", "partial", "paid"]))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(bookingRequests)
      .where(eq(bookingRequests.status, "new")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contracts)
      .where(
        and(
          eq(contracts.status, "active"),
          sql`${contracts.endDate} is not null`,
          sql`${contracts.endDate} <= date(${todayIso}, '+${sql.raw(String(EXPIRING_SOON_DAYS))} day')`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, ["issued", "partial"]),
          sql`${invoices.dueDate} < ${todayIso}`,
        ),
      ),
  ]);

  const counts = {
    occupied: roomViews.filter((room) => room.status === "Đang thuê").length,
    vacant: roomViews.filter((room) => room.status === "Trống").length,
    held: roomViews.filter((room) => room.status === "Đã giữ").length,
    maintenance: roomViews.filter((room) => room.status === "Bảo trì").length,
  };

  const propertyMap = new Map<string, { id: string; name: string; total: number; occupied: number }>();
  for (const room of roomViews) {
    const entry = propertyMap.get(room.propertyId) ?? {
      id: room.propertyId,
      name: room.propertyName,
      total: 0,
      occupied: 0,
    };
    entry.total += 1;
    if (room.status === "Đang thuê") entry.occupied += 1;
    propertyMap.set(room.propertyId, entry);
  }

  const billed = Number(periodTotals?.billed ?? 0);
  const collected = Number(periodTotals?.collected ?? 0);

  return {
    totalRooms: roomViews.length,
    occupiedRooms: counts.occupied,
    vacantRooms: counts.vacant,
    heldRooms: counts.held,
    maintenanceRooms: counts.maintenance,
    occupancyRate: roomViews.length ? Math.round((counts.occupied / roomViews.length) * 100) : 0,
    collected,
    billed,
    outstanding: billed - collected,
    overdueInvoices: Number(overdueRow?.count ?? 0),
    newBookings: Number(newBookingRow?.count ?? 0),
    expiringContracts: Number(expiringRow?.count ?? 0),
    byProperty: [...propertyMap.values()].map((entry) => ({
      ...entry,
      rate: entry.total ? Math.round((entry.occupied / entry.total) * 100) : 0,
    })),
  };
}

export type LedgerView = {
  id: string;
  code: string;
  direction: "in" | "out";
  category: string;
  description: string;
  amount: number;
  occurredAt: string;
  propertyName: string | null;
};

export async function listLedgerEntries(limit = 30): Promise<LedgerView[]> {
  const db = getDb();
  return db
    .select({
      id: ledgerEntries.id,
      code: ledgerEntries.code,
      direction: ledgerEntries.direction,
      category: ledgerEntries.category,
      description: ledgerEntries.description,
      amount: ledgerEntries.amount,
      occurredAt: ledgerEntries.occurredAt,
      propertyName: properties.name,
    })
    .from(ledgerEntries)
    .leftJoin(properties, eq(properties.id, ledgerEntries.propertyId))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.code))
    .limit(limit);
}
