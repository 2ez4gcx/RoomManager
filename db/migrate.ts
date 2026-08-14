import { sql } from "drizzle-orm";
import type { getDb } from "./index";

/**
 * Nạp toàn bộ file SQL trong `drizzle/` lúc build, sắp theo tên file nên thứ tự
 * migration giữ đúng như drizzle-kit sinh ra.
 */
const migrationFiles = import.meta.glob("../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function orderedStatements() {
  return Object.keys(migrationFiles)
    .sort()
    .flatMap((path) =>
      migrationFiles[path]
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

/**
 * Nhận diện câu lệnh đã được áp từ lần chạy trước.
 *
 * SQLite báo mỗi loại DDL một kiểu khác nhau:
 *
 * - `CREATE TABLE` / `CREATE INDEX` lặp → "already exists"
 * - `ALTER TABLE ADD COLUMN` lặp → "duplicate column name"
 * - `DROP INDEX` lặp → "no such index"
 *
 * Thiếu vế nào thì migration loại đó sẽ làm hỏng mọi lần chạy lại.
 *
 * D1 gói lỗi gốc vào `cause` và chỉ để "Failed query: ..." ở `message`, nên
 * phải duyệt cả chuỗi `cause`.
 */
const ALREADY_APPLIED = /already exists|duplicate column name|no such index/i;

function alreadyApplied(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (ALREADY_APPLIED.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Áp migration lên D1 cục bộ.
 *
 * Trên môi trường thật, control plane đã chạy SQL của drizzle khi deploy; hàm
 * này chỉ để `npm run dev` có sẵn bảng mà không cần cấu hình wrangler riêng.
 * Câu lệnh nào báo "already exists" thì bỏ qua để gọi lại nhiều lần vẫn an toàn.
 */
export async function applyMigrations(db: ReturnType<typeof getDb>) {
  let applied = 0;
  let skipped = 0;

  for (const statement of orderedStatements()) {
    try {
      await db.run(sql.raw(statement));
      applied += 1;
    } catch (error) {
      if (!alreadyApplied(error)) throw error;
      skipped += 1;
    }
  }

  return { applied, skipped };
}
