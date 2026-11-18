/** Cấu hình dạng khóa–giá trị: thông tin nhà trọ và bảng giá điện nước. */
import { sql } from "drizzle-orm";
import { getDb } from "./index";
import { ValidationError, writeAudit } from "./internal";
import { settings } from "./schema";

/** Khóa được phép ghi. Danh sách đóng để biểu mẫu không tạo được khóa lạ. */
export const SETTING_KEYS = [
  "org.name",
  "org.phone",
  "org.email",
  "org.address",
  "rate.electricity",
  "rate.water",
  "rate.service",
  "billing.defaultDay",
  "booking.holdDays",
  "reminder.daysBefore",
  "reminder.repeatEveryDays",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Khóa có giá trị phải là số nguyên không âm. */
const NUMERIC_KEYS = new Set<string>([
  "rate.electricity",
  "rate.water",
  "rate.service",
  "billing.defaultDay",
  "booking.holdDays",
  "reminder.daysBefore",
  "reminder.repeatEveryDays",
]);

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  "org.name": "",
  "org.phone": "",
  "org.email": "",
  "org.address": "",
  "rate.electricity": "3500",
  "rate.water": "100000",
  "rate.service": "150000",
  "billing.defaultDay": "5",
  "booking.holdDays": "3",
  /** Nhắc trước hạn bao nhiêu ngày. */
  "reminder.daysBefore": "3",
  /** Quá hạn thì cứ bao nhiêu ngày nhắc lại một lần. */
  "reminder.repeatEveryDays": "3",
};

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const db = getDb();
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);

  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return { ...DEFAULT_SETTINGS, ...stored } as Record<SettingKey, string>;
}

export async function updateSettings(
  values: Partial<Record<SettingKey, string>>,
  actorId: string,
) {
  const db = getDb();
  const entries = Object.entries(values).filter(([key]) =>
    (SETTING_KEYS as readonly string[]).includes(key),
  );

  if (entries.length === 0) {
    throw new ValidationError("Không có thiết lập nào để lưu.");
  }

  for (const [key, value] of entries) {
    if (NUMERIC_KEYS.has(key)) {
      // `Number("")` là 0: xóa trắng ô đơn giá điện mà không chặn thì từ kỳ sau
      // tiền điện được tính 0 đồng.
      if (String(value ?? "").trim() === "") {
        throw new ValidationError(`Chưa nhập giá trị cho "${key}".`, key);
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ValidationError(`Giá trị của "${key}" phải là số nguyên không âm.`, key);
      }
    }
    if (key === "billing.defaultDay") {
      const day = Number(value);
      if (day < 1 || day > 28) {
        throw new ValidationError("Ngày thu phải nằm trong khoảng 1–28.", key);
      }
    }
  }

  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value: String(value), updatedBy: actorId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(value), updatedBy: actorId, updatedAt: sql`(unixepoch() * 1000)` },
      });
  }

  await writeAudit(db, {
    actorId,
    action: "settings.update",
    entityType: "settings",
    entityId: "settings",
    changes: Object.fromEntries(entries),
  });

  return { updated: entries.length };
}
