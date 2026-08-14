/**
 * Schema RoomManager.
 *
 * Quy ước giữ cho schema dễ chuyển sang PostgreSQL về sau:
 * - Khóa chính là `text` do ứng dụng sinh (xem `db/ids.ts`), không dùng AUTOINCREMENT.
 * - Tiền lưu số nguyên VNĐ, không dùng số thực.
 * - Ngày lịch (bắt đầu hợp đồng, hạn thanh toán) lưu `text` dạng `YYYY-MM-DD`.
 * - Mốc thời gian hệ thống lưu epoch millisecond, Drizzle trả về `Date`.
 * - Trạng thái lưu `text` kèm union type ở tầng TypeScript thay vì enum của CSDL.
 */
import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/** Cột thời gian dùng chung cho mọi bảng nghiệp vụ. */
const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

/* ------------------------------------------------------------------ */
/* Tổ chức                                                            */
/* ------------------------------------------------------------------ */

export type UserRole = "owner" | "staff";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  /** Băm mật khẩu. Để trống cho tới khi module đăng nhập hoàn tất. */
  passwordHash: text("password_hash"),
  role: text("role").$type<UserRole>().notNull().default("staff"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  /** Khóa TOTP dạng base32. Có giá trị ngay khi bắt đầu cài đặt. */
  totpSecret: text("totp_secret"),
  /** Chỉ khác null khi người dùng đã nhập đúng mã xác nhận; đây mới là cờ "đã bật". */
  totpEnabledAt: integer("totp_enabled_at", { mode: "timestamp_ms" }),
  /** Bước thời gian của mã đã dùng gần nhất, chặn dùng lại cùng một mã. */
  totpLastCounter: integer("totp_last_counter"),

  ...timestamps,
});

/**
 * Mã khôi phục dùng khi mất điện thoại.
 *
 * Lưu băm SHA-256 chứ không lưu mã. Ở đây không cần PBKDF2 như mật khẩu: mã do
 * hệ thống sinh ngẫu nhiên đủ dài nên không dò được bằng từ điển, mà băm chậm
 * thì tốn CPU vô ích.
 */
export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("recovery_codes_user_idx").on(table.userId)],
);

/**
 * Phiên đăng nhập.
 *
 * `id` là băm SHA-256 của token trong cookie, không phải chính token. Rò rỉ
 * bảng này không cho phép mạo danh ai.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

/**
 * Lần đăng nhập sai, dùng để chặn dò mật khẩu.
 *
 * Chỉ ghi lần THẤT BẠI. Đăng nhập thành công thì xóa các bản ghi của cùng cặp
 * định danh + IP, nên bảng này không phình theo lượng đăng nhập bình thường.
 *
 * `identifier` là chuỗi người dùng gõ vào ô đăng nhập, ghi lại kể cả khi
 * không có tài khoản nào trùng — nếu chỉ đếm cho tài khoản có thật thì thời
 * gian phản hồi sẽ tiết lộ tài khoản nào tồn tại.
 */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    ip: text("ip").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("login_attempts_lookup_idx").on(table.identifier, table.ip, table.createdAt),
    index("login_attempts_ip_idx").on(table.ip, table.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Tài sản                                                            */
/* ------------------------------------------------------------------ */

export const properties = sqliteTable("properties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Mã ngắn dùng để dựng mã phòng, ví dụ `AP` → phòng `AP-101`. */
  code: text("code").notNull().unique(),
  address: text("address").notNull().default(""),
  /** Thứ tự hiển thị trong bộ lọc và danh sách. */
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const roomTypes = sqliteTable(
  "room_types",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Giá niêm yết mặc định, VNĐ/tháng. Giá thực tế chốt ở hợp đồng. */
    basePrice: integer("base_price").notNull(),
    area: integer("area").notNull().default(0),
    maxOccupants: integer("max_occupants").notNull().default(2),
    /** Danh sách tiện nghi, lưu JSON mảng chuỗi. */
    amenities: text("amenities", { mode: "json" }).$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    ...timestamps,
  },
  (table) => [unique("room_types_property_name_unq").on(table.propertyId, table.name)],
);

/**
 * Trạng thái vật lý của phòng.
 *
 * Cố ý KHÔNG lưu "đang thuê" hay "đã giữ" ở đây: hai trạng thái đó suy ra từ
 * hợp đồng và yêu cầu giữ chỗ (xem `db/queries.ts`). Lưu thêm cờ ở phòng sẽ
 * tạo ra hai nguồn sự thật mâu thuẫn nhau.
 */
export type RoomCondition = "usable" | "maintenance" | "retired";

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    roomTypeId: text("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
    /** Mã hiển thị, ví dụ `AP-101`. */
    code: text("code").notNull().unique(),
    /** Số phòng trong nhà, ví dụ `101`. */
    number: text("number").notNull(),
    floor: integer("floor").notNull().default(1),
    /** Giá thuê riêng của phòng; để trống thì lấy `roomTypes.basePrice`. */
    price: integer("price"),
    area: integer("area"),
    condition: text("condition").$type<RoomCondition>().notNull().default("usable"),
    note: text("note").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    unique("rooms_property_number_unq").on(table.propertyId, table.number),
    index("rooms_property_idx").on(table.propertyId),
  ],
);

/* ------------------------------------------------------------------ */
/* Khách thuê                                                         */
/* ------------------------------------------------------------------ */

export const guests = sqliteTable(
  "guests",
  {
    id: text("id").primaryKey(),
    /** Mã hiển thị cho chủ nhà, ví dụ `KH-001`. */
    code: text("code").notNull().unique(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    /** Số CCCD. Dữ liệu nhạy cảm, không được lộ ra trang công khai. */
    idNumber: text("id_number"),
    dateOfBirth: text("date_of_birth"),
    permanentAddress: text("permanent_address").notNull().default(""),
    note: text("note").notNull().default(""),
    ...timestamps,
  },
  (table) => [index("guests_phone_idx").on(table.phone)],
);

/* ------------------------------------------------------------------ */
/* Hợp đồng                                                           */
/* ------------------------------------------------------------------ */

export type ContractStatus = "active" | "ended" | "cancelled";

export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    /** Người đứng tên hợp đồng. Người ở cùng nằm ở `contract_guests`. */
    primaryGuestId: text("primary_guest_id")
      .notNull()
      .references(() => guests.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    /** Giá thuê chốt tại thời điểm ký, VNĐ/tháng. */
    rent: integer("rent").notNull(),
    deposit: integer("deposit").notNull().default(0),
    /** Ngày trong tháng phải thanh toán, 1–28. */
    billingDay: integer("billing_day").notNull().default(5),
    status: text("status").$type<ContractStatus>().notNull().default("active"),
    endedAt: text("ended_at"),
    endReason: text("end_reason").notNull().default(""),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("contracts_room_idx").on(table.roomId),
    index("contracts_status_idx").on(table.status),
  ],
);

export const contractGuests = sqliteTable(
  "contract_guests",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    relationship: text("relationship").notNull().default(""),
    ...timestamps,
  },
  (table) => [unique("contract_guests_unq").on(table.contractId, table.guestId)],
);

/* ------------------------------------------------------------------ */
/* Đặt phòng                                                          */
/* ------------------------------------------------------------------ */

export type BookingStatus = "new" | "contacted" | "confirmed" | "rejected";

export const bookingRequests = sqliteTable(
  "booking_requests",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    /** Nhu cầu của khách; có thể chưa chốt phòng cụ thể. */
    propertyId: text("property_id").references(() => properties.id),
    roomTypeId: text("room_type_id").references(() => roomTypes.id),
    roomId: text("room_id").references(() => rooms.id),
    preferredMoveIn: text("preferred_move_in"),
    occupants: integer("occupants").notNull().default(1),
    message: text("message").notNull().default(""),
    status: text("status").$type<BookingStatus>().notNull().default("new"),
    /** Giữ chỗ hết hạn lúc nào; hết hạn thì phòng trở lại trạng thái trống. */
    holdUntil: integer("hold_until", { mode: "timestamp_ms" }),
    handledBy: text("handled_by").references(() => users.id),
    internalNote: text("internal_note").notNull().default(""),
    ...timestamps,
  },
  (table) => [index("booking_requests_status_idx").on(table.status)],
);

/* ------------------------------------------------------------------ */
/* Điện nước                                                          */
/* ------------------------------------------------------------------ */

export type MeterKind = "electricity" | "water";

export const meterReadings = sqliteTable(
  "meter_readings",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MeterKind>().notNull(),
    /** Kỳ ghi chỉ số, dạng `YYYY-MM`. */
    period: text("period").notNull(),
    previousValue: integer("previous_value").notNull().default(0),
    currentValue: integer("current_value").notNull().default(0),
    /** Đơn giá tại thời điểm chốt, VNĐ/đơn vị. Lưu lại để lịch sử không đổi. */
    unitPrice: integer("unit_price").notNull(),
    readAt: text("read_at").notNull(),
    recordedBy: text("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [unique("meter_readings_unq").on(table.roomId, table.kind, table.period)],
);

/* ------------------------------------------------------------------ */
/* Đơn thu                                                            */
/* ------------------------------------------------------------------ */

export type InvoiceStatus = "draft" | "issued" | "partial" | "paid" | "cancelled";

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    /** Kỳ thu dạng `YYYY-MM`. */
    period: text("period").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    /** Tổng các dòng trong `invoice_items`, tính sẵn để không phải cộng lại khi liệt kê. */
    total: integer("total").notNull().default(0),
    /** Tổng đã cấn trừ từ `payment_allocations`. */
    paidAmount: integer("paid_amount").notNull().default(0),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    note: text("note").notNull().default(""),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason").notNull().default(""),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    unique("invoices_contract_period_unq").on(table.contractId, table.period),
    index("invoices_status_idx").on(table.status),
    index("invoices_period_idx").on(table.period),
  ],
);

export type InvoiceItemKind =
  | "rent"
  | "electricity"
  | "water"
  | "service"
  | "parking"
  | "other";

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    kind: text("kind").$type<InvoiceItemKind>().notNull(),
    description: text("description").notNull(),
    /** Nhân 100 để giữ 2 chữ số thập phân mà không dùng số thực. */
    quantityCenti: integer("quantity_centi").notNull().default(100),
    unit: text("unit").notNull().default(""),
    /** Đơn giá tại lúc lập đơn; bảng giá đổi về sau không làm đổi đơn cũ. */
    unitPrice: integer("unit_price").notNull(),
    /** Thành tiền chốt tại lúc lập đơn. */
    amount: integer("amount").notNull(),
    meterReadingId: text("meter_reading_id").references(() => meterReadings.id),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

/* ------------------------------------------------------------------ */
/* Thanh toán                                                         */
/* ------------------------------------------------------------------ */

export type PaymentMethod = "cash" | "transfer" | "card" | "other";

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    /** Số tiền thực nhận. Có thể được cấn vào nhiều đơn. */
    amount: integer("amount").notNull(),
    method: text("method").$type<PaymentMethod>().notNull().default("transfer"),
    paidAt: text("paid_at").notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    recordedBy: text("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [index("payments_guest_idx").on(table.guestId)],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: integer("amount").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("payment_allocations_unq").on(table.paymentId, table.invoiceId),
    index("payment_allocations_invoice_idx").on(table.invoiceId),
  ],
);

/* ------------------------------------------------------------------ */
/* Vận hành                                                           */
/* ------------------------------------------------------------------ */

export type LedgerDirection = "in" | "out";

/**
 * Sổ thu chi vận hành.
 *
 * Khoản thu tiền phòng được sinh từ `payments`; các khoản chi (bảo trì, điện
 * chung, vật tư) nhập tay. `amount` luôn dương, chiều tiền nằm ở `direction`.
 */
export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    propertyId: text("property_id").references(() => properties.id),
    direction: text("direction").$type<LedgerDirection>().notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    amount: integer("amount").notNull(),
    occurredAt: text("occurred_at").notNull(),
    /** Trỏ về khoản thanh toán đã sinh ra dòng này, nếu có. */
    paymentId: text("payment_id").references(() => payments.id),
    recordedBy: text("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("ledger_entries_occurred_idx").on(table.occurredAt),
    index("ledger_entries_property_idx").on(table.propertyId),
  ],
);

export type MaintenanceStatus = "open" | "in_progress" | "done" | "cancelled";

export const maintenanceRequests = sqliteTable(
  "maintenance_requests",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").references(() => rooms.id),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").$type<MaintenanceStatus>().notNull().default("open"),
    reportedAt: text("reported_at").notNull(),
    resolvedAt: text("resolved_at"),
    cost: integer("cost").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("maintenance_requests_status_idx").on(table.status)],
);

/**
 * Cấu hình dạng khóa–giá trị: bảng giá điện nước, thông tin xuất trên đơn...
 * Dùng bảng thay vì biến môi trường để chủ nhà đổi được từ trang Cài đặt.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  ...timestamps,
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Ảnh chụp thay đổi, JSON tự do. */
    changes: text("changes", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("audit_logs_entity_idx").on(table.entityType, table.entityId)],
);

/* ------------------------------------------------------------------ */
/* Quan hệ                                                            */
/* ------------------------------------------------------------------ */

export const propertiesRelations = relations(properties, ({ many }) => ({
  rooms: many(rooms),
  roomTypes: many(roomTypes),
}));

export const roomTypesRelations = relations(roomTypes, ({ one, many }) => ({
  property: one(properties, {
    fields: [roomTypes.propertyId],
    references: [properties.id],
  }),
  rooms: many(rooms),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  property: one(properties, { fields: [rooms.propertyId], references: [properties.id] }),
  roomType: one(roomTypes, { fields: [rooms.roomTypeId], references: [roomTypes.id] }),
  contracts: many(contracts),
  meterReadings: many(meterReadings),
}));

export const guestsRelations = relations(guests, ({ many }) => ({
  contracts: many(contracts),
  payments: many(payments),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  room: one(rooms, { fields: [contracts.roomId], references: [rooms.id] }),
  primaryGuest: one(guests, {
    fields: [contracts.primaryGuestId],
    references: [guests.id],
  }),
  occupants: many(contractGuests),
  invoices: many(invoices),
}));

export const contractGuestsRelations = relations(contractGuests, ({ one }) => ({
  contract: one(contracts, {
    fields: [contractGuests.contractId],
    references: [contracts.id],
  }),
  guest: one(guests, { fields: [contractGuests.guestId], references: [guests.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  contract: one(contracts, { fields: [invoices.contractId], references: [contracts.id] }),
  room: one(rooms, { fields: [invoices.roomId], references: [rooms.id] }),
  items: many(invoiceItems),
  allocations: many(paymentAllocations),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  guest: one(guests, { fields: [payments.guestId], references: [guests.id] }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentAllocations.paymentId],
    references: [payments.id],
  }),
  invoice: one(invoices, {
    fields: [paymentAllocations.invoiceId],
    references: [invoices.id],
  }),
}));

export const bookingRequestsRelations = relations(bookingRequests, ({ one }) => ({
  property: one(properties, {
    fields: [bookingRequests.propertyId],
    references: [properties.id],
  }),
  roomType: one(roomTypes, {
    fields: [bookingRequests.roomTypeId],
    references: [roomTypes.id],
  }),
  room: one(rooms, { fields: [bookingRequests.roomId], references: [rooms.id] }),
}));

export const meterReadingsRelations = relations(meterReadings, ({ one }) => ({
  room: one(rooms, { fields: [meterReadings.roomId], references: [rooms.id] }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  property: one(properties, {
    fields: [ledgerEntries.propertyId],
    references: [properties.id],
  }),
  payment: one(payments, { fields: [ledgerEntries.paymentId], references: [payments.id] }),
}));
