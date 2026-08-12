/** Tiện ích dùng chung cho các module ghi dữ liệu. */
import { desc } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "./index";
import { newId } from "./ids";
import { auditLogs } from "./schema";

export type Db = ReturnType<typeof getDb>;

/** Lỗi do dữ liệu người dùng nhập, khác với lỗi hệ thống. */
export class ValidationError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function writeAudit(
  db: Db,
  entry: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, unknown>;
  },
) {
  await db.insert(auditLogs).values({
    id: newId("aud"),
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes ?? null,
  });
}

/** `KH-007` → `KH-008`. Bỏ qua mã sai định dạng và bắt đầu lại từ 1. */
export function formatCode(prefix: string, lastCode: string | undefined, width = 3) {
  const lastNumber = Number(lastCode?.split("-").at(-1) ?? 0);
  const next = Number.isFinite(lastNumber) ? lastNumber + 1 : 1;
  return `${prefix}-${String(next).padStart(width, "0")}`;
}

/**
 * Mã kế tiếp của một bảng, dựa trên mã lớn nhất đang có.
 *
 * Chưa chống được hai yêu cầu tạo cùng lúc; các cột mã đều có ràng buộc UNIQUE
 * nên trường hợp đó báo lỗi thay vì tạo trùng.
 */
export async function nextCode(
  db: Db,
  table: SQLiteTable,
  column: SQLiteColumn,
  prefix: string,
  width = 3,
) {
  const [last] = await db
    .select({ code: column })
    .from(table)
    .orderBy(desc(column))
    .limit(1);

  return formatCode(prefix, last?.code as string | undefined, width);
}
