/**
 * Dữ liệu mẫu cho 2 nhà × 20 phòng.
 *
 * Đây là dữ liệu để chạy thử luồng nghiệp vụ, không phải dữ liệu thật của chủ
 * nhà. Mọi con số sinh ra theo công thức cố định nên chạy lại luôn cho cùng kết
 * quả, dễ so sánh khi kiểm tra.
 */
import { sql } from "drizzle-orm";
import { hashPassword } from "./auth";
import type { getDb } from "./index";
import { newId } from "./ids";
import { insertChunked } from "./internal";
import {
  auditLogs,
  bookingRequests,
  loginAttempts,
  sessions,
  contractGuests,
  contracts,
  guests,
  invoiceItems,
  invoices,
  ledgerEntries,
  maintenanceRequests,
  meterReadings,
  paymentAllocations,
  payments,
  properties,
  roomTypes,
  rooms,
  settings,
  users,
} from "./schema";

type Db = ReturnType<typeof getDb>;

/**
 * Tài khoản chủ nhà của DỮ LIỆU MẪU.
 *
 * Chỉ tồn tại trong cơ sở dữ liệu dùng để chạy thử và kiểm thử tự động. Mật
 * khẩu nằm công khai trong mã nguồn, nên dữ liệu mẫu tuyệt đối không được nạp
 * vào cơ sở dữ liệu thật.
 *
 * Muốn dùng thật thì khởi tạo trống rồi tạo tài khoản riêng — xem mục "Dùng
 * thật" trong README.
 */
export const OWNER_EMAIL = "quanly@hoangan.vn";
export const OWNER_PASSWORD = "roommanager";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

const SURNAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Mai"];
const MIDDLES = ["Minh", "Thanh", "Quốc", "Gia", "Ngọc", "Tuấn", "Kim", "Phương", "Hoài", "Đức", "Thu", "Xuân"];
const GIVENS = ["Anh", "Nam", "Huy", "Hà", "Kiệt", "Trúc", "Bảo", "Chi", "Thảo", "Việt", "Tâm", "Khang", "Linh", "Duy", "Nhi", "Sơn"];

function personName(seed: number) {
  return `${SURNAMES[seed % SURNAMES.length]} ${MIDDLES[(seed * 5) % MIDDLES.length]} ${GIVENS[(seed * 7) % GIVENS.length]}`;
}

function phoneNumber(seed: number) {
  const prefixes = ["090", "093", "097", "098", "091", "088", "096", "089"];
  const tail = String((seed * 739523 + 104729) % 10_000_000).padStart(7, "0");
  return `${prefixes[seed % prefixes.length]}${tail}`;
}

const ROOM_TYPE_TEMPLATES = [
  { name: "Gác lửng", basePrice: 3_800_000, area: 28, maxOccupants: 3, amenities: ["Có gác", "Bếp riêng", "Máy lạnh", "Wifi"] },
  { name: "Ban công", basePrice: 4_200_000, area: 24, maxOccupants: 2, amenities: ["Ban công", "Nhiều ánh sáng", "Máy lạnh", "Wifi"] },
  { name: "Studio", basePrice: 3_400_000, area: 22, maxOccupants: 2, amenities: ["Cửa sổ lớn", "Bếp riêng", "Máy lạnh", "Wifi"] },
];

const PROPERTY_TEMPLATES = [
  { code: "AP", name: "Nhà An Phú", address: "125 Nguyễn Văn Linh, Quận 7, TP.HCM" },
  { code: "BM", name: "Nhà Bình Minh", address: "42 Đường số 9, TP. Thủ Đức, TP.HCM" },
];

/** Chỉ số phòng (0–39) được xếp sẵn tình trạng để dữ liệu mẫu có đủ mọi ca. */
const VACANT_ROOMS = new Set([2, 9, 21, 28]);
const HELD_ROOMS = new Set([3, 24]);
const MAINTENANCE_ROOMS = new Set([5, 35]);

/** Xóa sạch dữ liệu theo thứ tự ngược khóa ngoại. */
export async function clearAll(db: Db) {
  for (const table of [
    loginAttempts,
    sessions,
    auditLogs,
    ledgerEntries,
    paymentAllocations,
    payments,
    invoiceItems,
    invoices,
    meterReadings,
    maintenanceRequests,
    bookingRequests,
    contractGuests,
    contracts,
    rooms,
    roomTypes,
    guests,
    properties,
    settings,
    users,
  ]) {
    await db.delete(table);
  }
}

export async function isSeeded(db: Db) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(properties);
  return (row?.count ?? 0) > 0;
}

export async function seed(db: Db) {
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  /* --- Người dùng ------------------------------------------------- */
  const ownerId = newId("usr");
  await db.insert(users).values({
    id: ownerId,
    email: OWNER_EMAIL,
    fullName: "Trần Hoàng",
    phone: "0901234567",
    role: "owner",
    passwordHash: await hashPassword(OWNER_PASSWORD),
  });

  /* --- Nhà và loại phòng ------------------------------------------ */
  const propertyRows = PROPERTY_TEMPLATES.map((template, index) => ({
    id: newId("prp"),
    name: template.name,
    code: template.code,
    address: template.address,
    sortOrder: index,
  }));
  await insertChunked(properties, propertyRows, (chunk) => db.insert(properties).values(chunk));

  const roomTypeRows = propertyRows.flatMap((property) =>
    ROOM_TYPE_TEMPLATES.map((template) => ({
      id: newId("rmt"),
      propertyId: property.id,
      name: template.name,
      basePrice: template.basePrice,
      area: template.area,
      maxOccupants: template.maxOccupants,
      amenities: template.amenities,
      description: `${template.name} tại ${property.name}`,
    })),
  );
  await insertChunked(roomTypes, roomTypeRows, (chunk) => db.insert(roomTypes).values(chunk));

  /* --- Phòng ------------------------------------------------------- */
  const roomRows = Array.from({ length: 40 }, (_, index) => {
    const propertyIndex = index < 20 ? 0 : 1;
    const property = propertyRows[propertyIndex];
    const local = index % 20;
    const floor = Math.floor(local / 5) + 1;
    const number = `${floor}${String((local % 5) + 1).padStart(2, "0")}`;
    const template = ROOM_TYPE_TEMPLATES[local % 3];
    const roomType = roomTypeRows.find(
      (type) => type.propertyId === property.id && type.name === template.name,
    )!;

    return {
      id: newId("rom"),
      propertyId: property.id,
      roomTypeId: roomType.id,
      code: `${property.code}-${number}`,
      number,
      floor,
      price: template.basePrice,
      area: template.area,
      condition: MAINTENANCE_ROOMS.has(index) ? ("maintenance" as const) : ("usable" as const),
      note: MAINTENANCE_ROOMS.has(index) ? "Đang sửa đường nước, dự kiến xong cuối tháng." : "",
    };
  });
  await insertChunked(rooms, roomRows, (chunk) => db.insert(rooms).values(chunk));

  /* --- Khách thuê và hợp đồng -------------------------------------- */
  const occupiedIndexes = roomRows
    .map((_, index) => index)
    .filter(
      (index) =>
        !VACANT_ROOMS.has(index) && !HELD_ROOMS.has(index) && !MAINTENANCE_ROOMS.has(index),
    );

  const guestRows = occupiedIndexes.map((roomIndex, order) => ({
    id: newId("gst"),
    code: `KH-${String(order + 1).padStart(3, "0")}`,
    fullName: personName(roomIndex),
    phone: phoneNumber(roomIndex),
    email: null,
    idNumber: `0${79_000_000_000 + roomIndex * 137}`,
    dateOfBirth: isoDate(new Date(Date.UTC(1990 + (roomIndex % 12), roomIndex % 12, ((roomIndex * 3) % 27) + 1))),
    permanentAddress: "",
    note: "",
  }));
  await insertChunked(guests, guestRows, (chunk) => db.insert(guests).values(chunk));

  const contractRows = occupiedIndexes.map((roomIndex, order) => {
    const room = roomRows[roomIndex];
    const guest = guestRows[order];
    const startedMonthsAgo = (roomIndex % 11) + 1;
    const start = addMonths(monthStart, -startedMonthsAgo);
    return {
      id: newId("ctr"),
      code: `HD-${String(order + 1).padStart(3, "0")}`,
      roomId: room.id,
      primaryGuestId: guest.id,
      startDate: isoDate(start),
      endDate: isoDate(addMonths(start, 12)),
      rent: room.price!,
      deposit: room.price!,
      billingDay: roomIndex % 2 === 0 ? 5 : 10,
      status: "active" as const,
      createdBy: ownerId,
    };
  });
  await insertChunked(contracts, contractRows, (chunk) => db.insert(contracts).values(chunk));

  await insertChunked(
    contractGuests,
    contractRows.map((contract, order) => ({
      id: newId("cgu"),
      contractId: contract.id,
      guestId: guestRows[order].id,
      relationship: "Người đứng tên",
    })),
    (chunk) => db.insert(contractGuests).values(chunk),
  );

  /* --- Chỉ số điện nước của kỳ hiện tại ---------------------------- */
  const electricityPrice = 3_500;
  const waterPricePerPerson = 100_000;
  const servicePrice = 150_000;

  const meterRows = occupiedIndexes.map((roomIndex, order) => {
    const previous = 1_200 + roomIndex * 37;
    const used = 80 + ((roomIndex * 7) % 90);
    return {
      id: newId("mtr"),
      roomId: roomRows[roomIndex].id,
      kind: "electricity" as const,
      period,
      previousValue: previous,
      currentValue: previous + used,
      unitPrice: electricityPrice,
      readAt: isoDate(monthStart),
      recordedBy: ownerId,
      _used: used,
      _order: order,
    };
  });
  await insertChunked(
    meterReadings,
    meterRows.map(({ _used, _order, ...row }) => {
      void _used;
      void _order;
      return row;
    }),
    (chunk) => db.insert(meterReadings).values(chunk),
  );

  /* --- Đơn thu kỳ hiện tại ----------------------------------------- */
  type SeededInvoice = {
    id: string;
    code: string;
    contractId: string;
    roomId: string;
    period: string;
    issueDate: string;
    dueDate: string;
    total: number;
    paidAmount: number;
    status: "issued" | "partial" | "paid";
    note: string;
    createdBy: string;
    _guestId: string;
    _items: Array<typeof invoiceItems.$inferInsert>;
  };

  const invoiceRows: SeededInvoice[] = occupiedIndexes.map((roomIndex, order) => {
    const contract = contractRows[order];
    const meter = meterRows[order];
    const occupants = 1 + (roomIndex % 2);
    const invoiceId = newId("inv");

    const electricityAmount = meter._used * electricityPrice;
    const waterAmount = occupants * waterPricePerPerson;
    const total = contract.rent + electricityAmount + waterAmount + servicePrice;

    // Chia đều ba tình huống để dashboard có đủ ca: chưa trả, trả một phần, đã đủ.
    const paymentCase = roomIndex % 5;
    const paidAmount =
      paymentCase === 0 ? 0 : paymentCase === 1 ? Math.round(total / 2 / 1000) * 1000 : total;
    const status = paidAmount === 0 ? "issued" : paidAmount < total ? "partial" : "paid";

    return {
      id: invoiceId,
      code: `DT-${period.replace("-", "")}-${roomRows[roomIndex].number}-${roomRows[roomIndex].code.slice(0, 2)}`,
      contractId: contract.id,
      roomId: roomRows[roomIndex].id,
      period,
      issueDate: isoDate(monthStart),
      dueDate: isoDate(addDays(monthStart, contract.billingDay - 1)),
      total,
      paidAmount,
      status,
      note: "",
      createdBy: ownerId,
      _guestId: contract.primaryGuestId,
      _items: [
        {
          id: newId("ivi"),
          invoiceId,
          kind: "rent" as const,
          description: `Tiền phòng ${period}`,
          quantityCenti: 100,
          unit: "tháng",
          unitPrice: contract.rent,
          amount: contract.rent,
          sortOrder: 0,
        },
        {
          id: newId("ivi"),
          invoiceId,
          kind: "electricity" as const,
          description: `Điện ${meter.previousValue} → ${meter.currentValue}`,
          quantityCenti: meter._used * 100,
          unit: "kWh",
          unitPrice: electricityPrice,
          amount: electricityAmount,
          meterReadingId: meter.id,
          sortOrder: 1,
        },
        {
          id: newId("ivi"),
          invoiceId,
          kind: "water" as const,
          description: `Nước ${occupants} người`,
          quantityCenti: occupants * 100,
          unit: "người",
          unitPrice: waterPricePerPerson,
          amount: waterAmount,
          sortOrder: 2,
        },
        {
          id: newId("ivi"),
          invoiceId,
          kind: "service" as const,
          description: "Phí dịch vụ chung",
          quantityCenti: 100,
          unit: "phòng",
          unitPrice: servicePrice,
          amount: servicePrice,
          sortOrder: 3,
        },
      ],
    };
  });

  await insertChunked(
    invoices,
    invoiceRows.map(({ _guestId, _items, ...row }) => {
      void _guestId;
      void _items;
      return row;
    }),
    (chunk) => db.insert(invoices).values(chunk),
  );
  await insertChunked(
    invoiceItems,
    invoiceRows.flatMap((invoice) => invoice._items),
    (chunk) => db.insert(invoiceItems).values(chunk),
  );

  /* --- Thanh toán và cấn trừ --------------------------------------- */
  const paidInvoices = invoiceRows.filter((invoice) => invoice.paidAmount > 0);
  const paymentRows = paidInvoices.map((invoice, order) => ({
    id: newId("pay"),
    code: `TT-${String(order + 1).padStart(4, "0")}`,
    guestId: invoice._guestId,
    amount: invoice.paidAmount,
    method: (order % 3 === 0 ? "cash" : "transfer") as "cash" | "transfer",
    paidAt: isoDate(addDays(monthStart, 2 + (order % 10))),
    reference: "",
    note: `Thu tiền kỳ ${invoice.period}`,
    recordedBy: ownerId,
  }));
  await insertChunked(payments, paymentRows, (chunk) => db.insert(payments).values(chunk));

  await insertChunked(
    paymentAllocations,
    paidInvoices.map((invoice, order) => ({
      id: newId("pal"),
      paymentId: paymentRows[order].id,
      invoiceId: invoice.id,
      amount: invoice.paidAmount,
    })),
    (chunk) => db.insert(paymentAllocations).values(chunk),
  );

  /* --- Sổ thu chi --------------------------------------------------- */
  const incomeEntries = paymentRows.map((payment, order) => ({
    propertyId: propertyRows[order % 2].id,
    direction: "in" as const,
    category: "Tiền phòng",
    description: payment.note,
    amount: payment.amount,
    occurredAt: payment.paidAt,
    paymentId: payment.id as string | null,
    recordedBy: ownerId,
  }));

  // Cọc vào sổ quỹ đúng ngày ký hợp đồng, không dồn vào tháng hiện tại.
  const depositEntries = contractRows.map((contract, order) => ({
    propertyId: roomRows[occupiedIndexes[order]].propertyId,
    direction: "in" as const,
    category: "Tiền cọc",
    description: `Cọc phòng ${roomRows[occupiedIndexes[order]].code} · ${guestRows[order].fullName}`,
    amount: contract.deposit,
    occurredAt: contract.startDate,
    paymentId: null as string | null,
    recordedBy: ownerId,
  }));

  const expenseTemplates = [
    { category: "Bảo trì", description: "Thay máy bơm nước", amount: 1_850_000, dayOffset: 3 },
    { category: "Điện nước chung", description: "Hóa đơn điện khu vực chung", amount: 1_280_000, dayOffset: 5 },
    { category: "Vật tư", description: "Khóa cửa và bóng đèn", amount: 465_000, dayOffset: 7 },
    { category: "Nhân sự", description: "Lương bảo vệ tháng này", amount: 6_000_000, dayOffset: 9 },
    { category: "Bảo trì", description: "Sửa đường nước tầng 2", amount: 2_400_000, dayOffset: 10 },
    { category: "Vệ sinh", description: "Thu gom rác và vệ sinh chung", amount: 900_000, dayOffset: 11 },
  ];
  const expenseEntries = expenseTemplates.map((template, order) => ({
    propertyId: propertyRows[order % 2].id,
    direction: "out" as const,
    category: template.category,
    description: template.description,
    amount: template.amount,
    occurredAt: isoDate(addDays(monthStart, template.dayOffset)),
    paymentId: null as string | null,
    recordedBy: ownerId,
  }));
  // Một dãy mã liên tục cho cả sổ: hàm sinh mã kế tiếp đọc số ở cuối mã lớn
  // nhất, nên chen mã dạng khác vào giữa sẽ làm nó trả về mã đã tồn tại.
  const ledgerRows = [...incomeEntries, ...depositEntries, ...expenseEntries].map(
    (entry, order) => ({
      ...entry,
      id: newId("led"),
      code: `GD-${String(order + 1).padStart(4, "0")}`,
    }),
  );
  await insertChunked(ledgerEntries, ledgerRows, (chunk) =>
    db.insert(ledgerEntries).values(chunk),
  );

  /* --- Yêu cầu đặt phòng -------------------------------------------- */
  const heldRoomIndexes = [...HELD_ROOMS];
  const bookingSeeds: Array<{
    status: "new" | "contacted" | "confirmed" | "rejected";
    roomIndex?: number;
    daysAgo: number;
  }> = [
    { status: "new", daysAgo: 0 },
    { status: "new", daysAgo: 0 },
    { status: "new", daysAgo: 1 },
    { status: "contacted", daysAgo: 2 },
    { status: "confirmed", roomIndex: heldRoomIndexes[0], daysAgo: 3 },
    { status: "confirmed", roomIndex: heldRoomIndexes[1], daysAgo: 4 },
    { status: "rejected", daysAgo: 5 },
  ];

  const bookingRows = bookingSeeds.map((seedRow, order) => {
    const roomIndex = seedRow.roomIndex ?? (order * 3) % 40;
    const room = roomRows[roomIndex];
    const roomType = roomTypeRows.find((type) => type.id === room.roomTypeId)!;
    return {
      id: newId("bkg"),
      code: `DP-${String(order + 1).padStart(3, "0")}`,
      fullName: personName(100 + order),
      phone: phoneNumber(200 + order),
      email: null,
      propertyId: room.propertyId,
      roomTypeId: roomType.id,
      roomId: seedRow.roomIndex === undefined ? null : room.id,
      preferredMoveIn: isoDate(addDays(now, 5 + order * 3)),
      occupants: 1 + (order % 2),
      message:
        order % 2 === 0
          ? "Muốn xem phòng vào buổi tối sau 18 giờ, ưu tiên phòng yên tĩnh."
          : "Cần chỗ để xe máy và có thể dọn vào cuối tuần.",
      status: seedRow.status,
      holdUntil:
        seedRow.status === "confirmed" ? addDays(now, 3) : null,
      handledBy: seedRow.status === "new" ? null : ownerId,
      internalNote: "",
    };
  });
  await insertChunked(bookingRequests, bookingRows, (chunk) => db.insert(bookingRequests).values(chunk));

  /* --- Bảo trì ------------------------------------------------------- */
  await insertChunked(
    maintenanceRequests,
    [...MAINTENANCE_ROOMS].map((roomIndex) => ({
      id: newId("mnt"),
      roomId: roomRows[roomIndex].id,
      propertyId: roomRows[roomIndex].propertyId,
      title: "Sửa đường nước",
      detail: "Đường ống rò rỉ, đã khóa van chờ thợ.",
      status: "in_progress" as const,
      reportedAt: isoDate(addDays(now, -6)),
      resolvedAt: null,
      cost: 0,
    })),
    (chunk) => db.insert(maintenanceRequests).values(chunk),
  );

  /* --- Cấu hình ------------------------------------------------------ */
  await insertChunked(
    settings,
    [
      { key: "org.name", value: "Hệ thống nhà trọ Hoàng An" },
      { key: "org.phone", value: "0901234567" },
      { key: "org.email", value: "quanly@hoangan.vn" },
      { key: "org.address", value: "125 Nguyễn Văn Linh, Quận 7, TP.HCM" },
      { key: "rate.electricity", value: String(electricityPrice) },
      { key: "rate.water", value: String(waterPricePerPerson) },
      { key: "rate.service", value: String(servicePrice) },
      { key: "billing.defaultDay", value: "5" },
      { key: "booking.holdDays", value: "3" },
    ].map((row) => ({ ...row, updatedBy: ownerId })),
    (chunk) => db.insert(settings).values(chunk),
  );

  return {
    properties: propertyRows.length,
    rooms: roomRows.length,
    guests: guestRows.length,
    contracts: contractRows.length,
    invoices: invoiceRows.length,
    payments: paymentRows.length,
    bookings: bookingRows.length,
    ownerEmail: OWNER_EMAIL,
  };
}
