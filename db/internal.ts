/** Tiện ích dùng chung cho các module ghi dữ liệu. */
import { desc, getTableColumns, like, sql } from "drizzle-orm";
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

/**
 * Ngày hôm nay theo giờ Việt Nam (UTC+7, không đổi giờ theo mùa).
 *
 * Worker chạy theo UTC: lấy ngày bằng `toISOString()` thì từ 0 giờ tới 7 giờ
 * sáng ở Việt Nam vẫn là "hôm qua".
 */
export function todayInVietnam(now = Date.now()) {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Chạy một truy vấn `IN (...)` theo từng lô id rồi gộp kết quả.
 *
 * D1 giới hạn 100 tham số mỗi câu lệnh. Truyền thẳng danh sách id của mọi hợp
 * đồng vào `inArray` thì từ khoảng 99 hợp đồng trở lên câu lệnh vỡ, và cả màn
 * hình lập đơn thu ngừng chạy đúng lúc nhà trọ lớn lên.
 */
const MAX_IN_LIST = 80;

export async function selectInChunks<TId, TRow>(
  ids: TId[],
  run: (chunk: TId[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  for (let index = 0; index < ids.length; index += MAX_IN_LIST) {
    rows.push(...(await run(ids.slice(index, index + MAX_IN_LIST))));
  }
  return rows;
}

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
 * Mã kế tiếp của một bảng, dựa trên mã có phần SỐ lớn nhất đang có.
 *
 * Phải so theo số chứ không theo chuỗi: so chuỗi thì `DP-999` lớn hơn
 * `DP-1000`, nên từ dòng thứ 1.000 trở đi hàm cứ trả lại `DP-1000` và mọi lần
 * tạo mới đều vấp ràng buộc UNIQUE — bảng đó hỏng vĩnh viễn. Độ rộng `width`
 * vì thế chỉ còn là cách hiển thị, không phải giới hạn số dòng.
 *
 * Chỉ xét mã đúng tiền tố; mã dạng khác chen vào cùng bảng bị bỏ qua.
 *
 * Hai yêu cầu tạo cùng lúc vẫn có thể đọc ra cùng một mã. Ràng buộc UNIQUE
 * chặn việc tạo trùng; bọc lệnh ghi trong `withCodeRetry` để lần thua tự lấy
 * mã mới thay vì báo lỗi.
 */
export async function nextCode(
  db: Db,
  table: SQLiteTable,
  column: SQLiteColumn,
  prefix: string,
  width = 3,
) {
  const number = sql<number>`CAST(substr(${column}, ${prefix.length + 2}) AS INTEGER)`;
  const [last] = await db
    .select({ code: column })
    .from(table)
    .where(like(column, `${prefix}-%`))
    .orderBy(desc(number))
    .limit(1);

  return formatCode(prefix, last?.code as string | undefined, width);
}

/**
 * Lỗi có phải do trùng cột mã (`<bảng>.code`) không.
 *
 * D1 gói lỗi gốc vào `cause` và chỉ để "Failed query: ..." ở `message`, nên
 * phải duyệt cả chuỗi `cause`.
 */
export function isCodeCollision(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/UNIQUE constraint failed: \w+\.code\b/.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * Chạy một lệnh ghi có dùng `nextCode`, thử lại khi trùng mã.
 *
 * `run` phải tự gọi `nextCode` bên trong, để mỗi lần thử lấy mã mới.
 */
export async function withCodeRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isCodeCollision(error)) throw error;
    }
  }
}

/**
 * Chèn nhiều dòng theo lô nhỏ.
 *
 * D1 giới hạn 100 tham số ràng buộc mỗi câu lệnh, nên một lệnh INSERT với vài
 * chục dòng sẽ vỡ.
 *
 * Chia lô theo số cột của BẢNG, không theo số khóa của object truyền vào:
 * Drizzle còn sinh tham số cho những cột có giá trị mặc định mà lời gọi không
 * nhắc tới, nên đếm theo object sẽ ra ít hơn thực tế và vẫn vượt giới hạn khi
 * chèn nhiều dòng.
 */
const MAX_BOUND_PARAMS = 90;

export async function insertChunked<TRow extends Record<string, unknown>>(
  table: SQLiteTable,
  rows: TRow[],
  run: (chunk: TRow[]) => Promise<unknown>,
) {
  if (rows.length === 0) return;

  const columns = Object.keys(getTableColumns(table)).length || 1;
  const perChunk = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns));

  for (let index = 0; index < rows.length; index += perChunk) {
    await run(rows.slice(index, index + perChunk));
  }
}
