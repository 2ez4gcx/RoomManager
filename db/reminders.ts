/**
 * Nhắc nợ tự động.
 *
 * Mỗi ngày hệ thống rà các đơn chưa thu đủ và sinh lời nhắc cho ba mốc: sắp
 * đến hạn, đúng hạn, và quá hạn lặp lại theo chu kỳ.
 *
 * Phần GỬI tin chưa tự động: Zalo OA phải duyệt hồ sơ, SMS và email đều cần
 * tài khoản dịch vụ trả phí. Nên ở đây hệ thống soạn sẵn nội dung, chủ nhà
 * chuyển qua Zalo hoặc gọi điện rồi bấm đánh dấu đã nhắc. Khi nào có dịch vụ
 * thì chỉ cần thêm bước gửi vào `generateReminders`, phần còn lại giữ nguyên.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { insertChunked, ValidationError, writeAudit } from "./internal";
import {
  contracts,
  guests,
  invoices,
  properties,
  reminders,
  rooms,
  type ReminderKind,
} from "./schema";
import { getSettings } from "./settings";

/** Nhãn tiếng Việt cho từng mốc nhắc. */
export const REMINDER_LABEL: Record<ReminderKind, string> = {
  before_due: "Sắp đến hạn",
  due: "Đến hạn hôm nay",
  overdue: "Quá hạn",
};

function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString("vi-VN")}đ`;
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Soạn nội dung tin nhắn.
 *
 * Xưng "anh/chị" vì hệ thống không lưu giới tính khách thuê, và đây cũng là
 * cách xưng hô trung tính thông dụng.
 */
function composeMessage(input: {
  kind: ReminderKind;
  tenantName: string;
  roomCode: string;
  period: string;
  amount: number;
  dueDate: string;
  today: string;
  orgName: string;
}) {
  const money = formatMoney(input.amount);
  const due = formatDate(input.dueDate);
  const opening = `Chào anh/chị ${input.tenantName},`;
  const closing = input.orgName ? `\n\n${input.orgName}` : "";

  if (input.kind === "before_due") {
    const left = daysBetween(input.today, input.dueDate);
    return `${opening}\n\nTiền phòng ${input.roomCode} kỳ ${input.period} là ${money}, hạn thanh toán ngày ${due} (còn ${left} ngày).\n\nAnh/chị sắp xếp giúp em nhé. Cảm ơn anh/chị!${closing}`;
  }

  if (input.kind === "due") {
    return `${opening}\n\nHôm nay là hạn thanh toán tiền phòng ${input.roomCode} kỳ ${input.period}, số tiền ${money}.\n\nAnh/chị thanh toán giúp em trong hôm nay nhé. Cảm ơn anh/chị!${closing}`;
  }

  const late = daysBetween(input.dueDate, input.today);
  return `${opening}\n\nTiền phòng ${input.roomCode} kỳ ${input.period} là ${money}, đã quá hạn ${late} ngày (hạn ngày ${due}).\n\nAnh/chị thu xếp thanh toán giúp em nhé. Nếu đã chuyển khoản rồi thì anh/chị báo lại để em đối chiếu. Cảm ơn anh/chị!${closing}`;
}

export type ReminderView = {
  id: string;
  invoiceId: string;
  invoiceCode: string;
  kind: ReminderKind;
  kindLabel: string;
  scheduledFor: string;
  dueDate: string;
  amount: number;
  message: string;
  tenantName: string;
  tenantPhone: string;
  roomCode: string;
  propertyName: string;
  period: string;
  sentAt: string | null;
  channel: string | null;
};

export type GenerateResult = {
  today: string;
  created: number;
  /** Đơn cần nhắc nhưng hôm nay đã có lời nhắc rồi. */
  skipped: number;
};

/**
 * Rà và sinh lời nhắc cho ngày `today`.
 *
 * Gọi lại nhiều lần trong ngày cũng chỉ tạo một lời nhắc cho mỗi đơn — ràng
 * buộc UNIQUE `(invoice_id, scheduled_for)` lo việc đó, và hàm cũng tự lọc
 * trước để không phải dựa vào lỗi khóa.
 */
export async function generateReminders(today = new Date().toISOString().slice(0, 10)) {
  const db = getDb();
  const settings = await getSettings();

  const daysBefore = Number(settings["reminder.daysBefore"]);
  const repeatEvery = Math.max(Number(settings["reminder.repeatEveryDays"]), 1);
  const orgName = settings["org.name"] ?? "";

  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceCode: invoices.code,
      period: invoices.period,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      roomCode: rooms.code,
      tenantName: guests.fullName,
    })
    .from(invoices)
    .innerJoin(rooms, eq(rooms.id, invoices.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .where(inArray(invoices.status, ["issued", "partial"]));

  const invoiceIds = rows.map((row) => row.invoiceId);
  const existing =
    invoiceIds.length === 0
      ? []
      : await db
          .select({ invoiceId: reminders.invoiceId })
          .from(reminders)
          .where(
            and(
              eq(reminders.scheduledFor, today),
              inArray(reminders.invoiceId, invoiceIds),
            ),
          );
  const alreadyToday = new Set(existing.map((row) => row.invoiceId));

  const toCreate: Array<typeof reminders.$inferInsert> = [];
  let skipped = 0;

  for (const row of rows) {
    const amount = row.total - row.paidAmount;
    if (amount <= 0) continue;

    const offset = daysBetween(today, row.dueDate);
    let kind: ReminderKind | null = null;

    if (offset === 0) {
      kind = "due";
    } else if (offset > 0 && offset <= daysBefore) {
      kind = "before_due";
    } else if (offset < 0) {
      // Quá hạn thì nhắc lại theo chu kỳ, không nhắc mỗi ngày.
      const lateDays = -offset;
      if (lateDays % repeatEvery === 0) kind = "overdue";
    }

    if (!kind) continue;

    if (alreadyToday.has(row.invoiceId)) {
      skipped += 1;
      continue;
    }

    toCreate.push({
      id: newId("rmd"),
      invoiceId: row.invoiceId,
      kind,
      scheduledFor: today,
      dueDate: row.dueDate,
      amount,
      message: composeMessage({
        kind,
        tenantName: row.tenantName,
        roomCode: row.roomCode,
        period: row.period,
        amount,
        dueDate: row.dueDate,
        today,
        orgName,
      }),
    });
  }

  await insertChunked(reminders, toCreate, (chunk) =>
    db.insert(reminders).values(chunk),
  );

  return { today, created: toCreate.length, skipped } satisfies GenerateResult;
}

export async function listReminders(options?: { includeSent?: boolean }) {
  const db = getDb();

  const rows = await db
    .select({
      id: reminders.id,
      invoiceId: reminders.invoiceId,
      invoiceCode: invoices.code,
      kind: reminders.kind,
      scheduledFor: reminders.scheduledFor,
      dueDate: reminders.dueDate,
      amount: reminders.amount,
      message: reminders.message,
      sentAt: reminders.sentAt,
      channel: reminders.channel,
      tenantName: guests.fullName,
      tenantPhone: guests.phone,
      roomCode: rooms.code,
      propertyName: properties.name,
      period: invoices.period,
    })
    .from(reminders)
    .innerJoin(invoices, eq(invoices.id, reminders.invoiceId))
    .innerJoin(rooms, eq(rooms.id, invoices.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .where(options?.includeSent ? undefined : isNull(reminders.sentAt))
    .orderBy(desc(reminders.scheduledFor), asc(rooms.code))
    .limit(300);

  return rows.map((row) => ({
    ...row,
    kindLabel: REMINDER_LABEL[row.kind],
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  })) satisfies ReminderView[];
}

/** Số lời nhắc chưa gửi, dùng cho huy hiệu trên thanh điều hướng. */
export async function pendingReminderCount() {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reminders)
    .where(isNull(reminders.sentAt));
  return Number(row?.count ?? 0);
}

const CHANNELS = ["zalo", "sms", "goi_dien", "khac"] as const;

export async function markReminderSent(input: {
  reminderId: string;
  channel: string;
  actorId: string;
}) {
  const db = getDb();

  if (!(CHANNELS as readonly string[]).includes(input.channel)) {
    throw new ValidationError("Kênh nhắc không hợp lệ.", "channel");
  }

  const [reminder] = await db
    .select({ id: reminders.id, sentAt: reminders.sentAt })
    .from(reminders)
    .where(eq(reminders.id, input.reminderId))
    .limit(1);
  if (!reminder) throw new ValidationError("Không tìm thấy lời nhắc.", "reminderId");
  if (reminder.sentAt) throw new ValidationError("Lời nhắc này đã đánh dấu rồi.", "reminderId");

  await db
    .update(reminders)
    .set({ sentAt: new Date(), channel: input.channel, sentBy: input.actorId })
    .where(eq(reminders.id, reminder.id));

  await writeAudit(db, {
    actorId: input.actorId,
    action: "reminder.sent",
    entityType: "reminder",
    entityId: reminder.id,
    changes: { channel: input.channel },
  });

  return { ok: true };
}

/** Bỏ qua lời nhắc mà không gửi, ví dụ khách vừa báo đã chuyển khoản. */
export async function dismissReminder(input: { reminderId: string; actorId: string }) {
  return markReminderSent({ ...input, channel: "khac" });
}
