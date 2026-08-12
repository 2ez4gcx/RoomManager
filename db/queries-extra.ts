/**
 * Truy vấn cho các trang Đặt phòng, Đơn thu, Thu chi và trang công khai.
 *
 * Tách khỏi `db/queries.ts` cho gọn; các kiểu dữ liệu dùng chung vẫn lấy từ đó.
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  bookingRequests,
  contracts,
  guests,
  invoiceItems,
  invoices,
  ledgerEntries,
  properties,
  roomTypes,
  rooms,
} from "./schema";

/* ------------------------------------------------------------------ */
/* Đặt phòng                                                          */
/* ------------------------------------------------------------------ */

export type BookingView = {
  id: string;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  propertyName: string | null;
  roomTypeName: string | null;
  roomCode: string | null;
  roomId: string | null;
  preferredMoveIn: string | null;
  occupants: number;
  message: string;
  status: "new" | "contacted" | "confirmed" | "rejected";
  holdUntil: string | null;
  createdAt: string;
};

export async function listBookingRequests(): Promise<BookingView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: bookingRequests.id,
      code: bookingRequests.code,
      fullName: bookingRequests.fullName,
      phone: bookingRequests.phone,
      email: bookingRequests.email,
      propertyName: properties.name,
      roomTypeName: roomTypes.name,
      roomCode: rooms.code,
      roomId: bookingRequests.roomId,
      preferredMoveIn: bookingRequests.preferredMoveIn,
      occupants: bookingRequests.occupants,
      message: bookingRequests.message,
      status: bookingRequests.status,
      holdUntil: bookingRequests.holdUntil,
      createdAt: bookingRequests.createdAt,
    })
    .from(bookingRequests)
    .leftJoin(properties, eq(properties.id, bookingRequests.propertyId))
    .leftJoin(roomTypes, eq(roomTypes.id, bookingRequests.roomTypeId))
    .leftJoin(rooms, eq(rooms.id, bookingRequests.roomId))
    .orderBy(desc(bookingRequests.createdAt));

  return rows.map((row) => ({
    ...row,
    // Chuyển Date thành chuỗi vì server component chỉ truyền được dữ liệu tuần tự hóa được.
    holdUntil: row.holdUntil ? row.holdUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type BookingStats = {
  total: number;
  newCount: number;
  confirmedCount: number;
  conversionRate: number;
};

export async function bookingStats(): Promise<BookingStats> {
  const db = getDb();
  const rows = await db
    .select({ status: bookingRequests.status, count: sql<number>`count(*)` })
    .from(bookingRequests)
    .groupBy(bookingRequests.status);

  const byStatus = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const total = [...byStatus.values()].reduce((sum, value) => sum + value, 0);
  const confirmed = byStatus.get("confirmed") ?? 0;

  return {
    total,
    newCount: byStatus.get("new") ?? 0,
    confirmedCount: confirmed,
    conversionRate: total ? Math.round((confirmed / total) * 100) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Đơn thu                                                            */
/* ------------------------------------------------------------------ */

export type InvoiceLine = {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
};

export type InvoiceView = {
  id: string;
  code: string;
  roomCode: string;
  propertyName: string;
  tenantName: string;
  period: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paidAmount: number;
  outstanding: number;
  status: "draft" | "issued" | "partial" | "paid" | "cancelled";
  /** Nhãn tiếng Việt đã tính cả việc quá hạn hay chưa. */
  statusLabel: string;
  items: InvoiceLine[];
};

const STATUS_LABELS: Record<InvoiceView["status"], string> = {
  draft: "Nháp",
  issued: "Chờ thanh toán",
  partial: "Thanh toán một phần",
  paid: "Đã thanh toán",
  cancelled: "Đã hủy",
};

export async function listInvoices(period?: string): Promise<InvoiceView[]> {
  const db = getDb();
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      roomCode: rooms.code,
      propertyName: properties.name,
      tenantName: guests.fullName,
      period: invoices.period,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(rooms, eq(rooms.id, invoices.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .where(period ? eq(invoices.period, period) : undefined)
    .orderBy(desc(invoices.period), rooms.code);

  const lines = await db
    .select({
      id: invoiceItems.id,
      invoiceId: invoiceItems.invoiceId,
      kind: invoiceItems.kind,
      description: invoiceItems.description,
      quantityCenti: invoiceItems.quantityCenti,
      unit: invoiceItems.unit,
      unitPrice: invoiceItems.unitPrice,
      amount: invoiceItems.amount,
      sortOrder: invoiceItems.sortOrder,
    })
    .from(invoiceItems)
    .orderBy(invoiceItems.invoiceId, asc(invoiceItems.sortOrder));

  const byInvoice = new Map<string, InvoiceLine[]>();
  for (const line of lines) {
    const list = byInvoice.get(line.invoiceId) ?? [];
    list.push({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: line.quantityCenti / 100,
      unit: line.unit,
      unitPrice: line.unitPrice,
      amount: line.amount,
    });
    byInvoice.set(line.invoiceId, list);
  }

  return rows.map((row) => {
    const outstanding = row.total - row.paidAmount;
    // "Quá hạn" không phải trạng thái lưu trong CSDL mà suy ra từ hạn thanh toán.
    const overdue =
      outstanding > 0 && row.dueDate < todayIso && row.status !== "cancelled";

    return {
      ...row,
      outstanding,
      statusLabel: overdue ? "Quá hạn" : STATUS_LABELS[row.status],
      items: byInvoice.get(row.id) ?? [],
    };
  });
}

export type InvoiceSummary = {
  period: string;
  billed: number;
  collected: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  invoiceCount: number;
  periods: string[];
};

export async function invoiceSummary(period: string): Promise<InvoiceSummary> {
  const db = getDb();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [totals] = await db
    .select({
      billed: sql<number>`coalesce(sum(${invoices.total}), 0)`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)`,
      invoiceCount: sql<number>`count(*)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.period, period),
        inArray(invoices.status, ["issued", "partial", "paid"]),
      ),
    );

  const [overdue] = await db
    .select({
      amount: sql<number>`coalesce(sum(${invoices.total} - ${invoices.paidAmount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.status, ["issued", "partial"]),
        sql`${invoices.dueDate} < ${todayIso}`,
      ),
    );

  const periodRows = await db
    .selectDistinct({ period: invoices.period })
    .from(invoices)
    .orderBy(desc(invoices.period));

  const billed = Number(totals?.billed ?? 0);
  const collected = Number(totals?.collected ?? 0);

  return {
    period,
    billed,
    collected,
    outstanding: billed - collected,
    overdueAmount: Number(overdue?.amount ?? 0),
    overdueCount: Number(overdue?.count ?? 0),
    invoiceCount: Number(totals?.invoiceCount ?? 0),
    periods: periodRows.map((row) => row.period),
  };
}

/* ------------------------------------------------------------------ */
/* Thu chi                                                            */
/* ------------------------------------------------------------------ */

export type CashflowSummary = {
  income: number;
  expense: number;
  net: number;
  margin: number;
  /** Sáu tháng gần nhất, cũ đến mới. */
  monthly: Array<{ period: string; label: string; income: number; expense: number }>;
  expenseByCategory: Array<{ category: string; amount: number; share: number }>;
};

export async function cashflowSummary(period: string): Promise<CashflowSummary> {
  const db = getDb();

  const rows = await db
    .select({
      period: sql<string>`substr(${ledgerEntries.occurredAt}, 1, 7)`,
      direction: ledgerEntries.direction,
      amount: sql<number>`sum(${ledgerEntries.amount})`,
    })
    .from(ledgerEntries)
    .groupBy(sql`substr(${ledgerEntries.occurredAt}, 1, 7)`, ledgerEntries.direction);

  const monthly = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    const entry = monthly.get(row.period) ?? { income: 0, expense: 0 };
    if (row.direction === "in") entry.income = Number(row.amount);
    else entry.expense = Number(row.amount);
    monthly.set(row.period, entry);
  }

  // Luôn dựng đủ 6 tháng liền kề để biểu đồ không bị khuyết cột.
  const months: CashflowSummary["monthly"] = [];
  const cursor = new Date(`${period}-01T00:00:00Z`);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(cursor);
    date.setUTCMonth(date.getUTCMonth() - offset);
    const key = date.toISOString().slice(0, 7);
    const entry = monthly.get(key) ?? { income: 0, expense: 0 };
    months.push({ period: key, label: `T${date.getUTCMonth() + 1}`, ...entry });
  }

  const categories = await db
    .select({
      category: ledgerEntries.category,
      amount: sql<number>`sum(${ledgerEntries.amount})`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.direction, "out"),
        sql`substr(${ledgerEntries.occurredAt}, 1, 7) = ${period}`,
      ),
    )
    .groupBy(ledgerEntries.category)
    .orderBy(desc(sql`sum(${ledgerEntries.amount})`));

  const current = months.at(-1) ?? { income: 0, expense: 0 };
  const expenseTotal = categories.reduce((sum, row) => sum + Number(row.amount), 0);

  return {
    income: current.income,
    expense: current.expense,
    net: current.income - current.expense,
    margin: current.income ? Math.round(((current.income - current.expense) / current.income) * 100) : 0,
    monthly: months,
    expenseByCategory: categories.map((row) => ({
      category: row.category,
      amount: Number(row.amount),
      share: expenseTotal ? Math.round((Number(row.amount) / expenseTotal) * 100) : 0,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Trang công khai                                                    */
/* ------------------------------------------------------------------ */

export type PublicRoom = {
  id: string;
  code: string;
  propertyName: string;
  propertyAddress: string;
  roomTypeName: string;
  floor: number;
  area: number;
  price: number;
  maxOccupants: number;
  amenities: string[];
};

/**
 * Phòng còn trống để hiển thị công khai.
 *
 * Chỉ trả về thông tin về phòng. Không có tên khách thuê, số điện thoại, công
 * nợ hay mã hợp đồng — đây là ranh giới bảo mật, không phải lựa chọn hiển thị.
 */
export async function listPublicVacantRooms(): Promise<PublicRoom[]> {
  const db = getDb();

  const held = await db
    .select({ roomId: bookingRequests.roomId })
    .from(bookingRequests)
    .where(
      and(
        eq(bookingRequests.status, "confirmed"),
        gt(bookingRequests.holdUntil, new Date()),
      ),
    );
  const heldIds = new Set(held.map((row) => row.roomId).filter(Boolean));

  const rows = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      floor: rooms.floor,
      area: rooms.area,
      price: rooms.price,
      contractId: contracts.id,
      propertyName: properties.name,
      propertyAddress: properties.address,
      propertySort: properties.sortOrder,
      roomTypeName: roomTypes.name,
      basePrice: roomTypes.basePrice,
      baseArea: roomTypes.area,
      maxOccupants: roomTypes.maxOccupants,
      amenities: roomTypes.amenities,
    })
    .from(rooms)
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .leftJoin(
      contracts,
      and(eq(contracts.roomId, rooms.id), eq(contracts.status, "active")),
    )
    .where(eq(rooms.condition, "usable"))
    .orderBy(properties.sortOrder, rooms.code);

  return rows
    .filter((row) => !row.contractId && !heldIds.has(row.id))
    .map((row) => ({
      id: row.id,
      code: row.code,
      propertyName: row.propertyName,
      propertyAddress: row.propertyAddress,
      roomTypeName: row.roomTypeName,
      floor: row.floor,
      area: row.area ?? row.baseArea,
      price: row.price ?? row.basePrice,
      maxOccupants: row.maxOccupants,
      amenities: row.amenities ?? [],
    }));
}

export type PublicProperty = {
  id: string;
  name: string;
  address: string;
  totalRooms: number;
  vacantRooms: number;
};

export async function listPublicProperties(): Promise<PublicProperty[]> {
  const db = getDb();
  const vacant = await listPublicVacantRooms();

  const rows = await db
    .select({
      id: properties.id,
      name: properties.name,
      address: properties.address,
      totalRooms: sql<number>`count(${rooms.id})`,
    })
    .from(properties)
    .leftJoin(rooms, eq(rooms.propertyId, properties.id))
    .where(eq(properties.isActive, true))
    .groupBy(properties.id)
    .orderBy(properties.sortOrder);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    totalRooms: Number(row.totalRooms),
    vacantRooms: vacant.filter((room) => room.propertyName === row.name).length,
  }));
}
