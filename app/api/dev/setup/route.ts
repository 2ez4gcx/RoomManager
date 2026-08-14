/**
 * Dựng bảng và nạp dữ liệu mẫu cho D1 cục bộ.
 *
 * Chỉ dùng khi phát triển. Trên môi trường thật, control plane đã áp migration
 * lúc deploy và dữ liệu là dữ liệu thật của chủ nhà, nên route này tự khóa lại
 * trừ khi được bật rõ ràng bằng biến môi trường `ALLOW_DEV_SETUP`.
 */
import { getDb } from "../../../../db";
import { applyMigrations } from "../../../../db/migrate";
import { clearAll, isSeeded, seed } from "../../../../db/seed";
import { devSetupLocked, isDevSetupEnabled } from "../../../lib/dev-setup";

export async function POST(request: Request) {
  if (!isDevSetupEnabled()) return devSetupLocked();

  const params = new URL(request.url).searchParams;
  const reset = params.get("reset") === "true";
  // Khởi tạo trống: dựng bảng, xóa sạch, KHÔNG nạp dữ liệu mẫu. Dùng khi bắt
  // đầu nhập dữ liệu thật của nhà trọ.
  const empty = params.get("empty") === "true";
  // Chỉ áp migration, không đụng tới một dòng dữ liệu nào. `start.bat` gọi chế
  // độ này mỗi lần khởi động khi máy đang chứa dữ liệu thật.
  const migrateOnly = params.get("migrate") === "true";

  try {
    const db = getDb();
    const migration = await applyMigrations(db);

    if (migrateOnly) {
      return Response.json({ ok: true, migration, seeded: false });
    }

    if (empty) {
      await clearAll(db);
      return Response.json({
        ok: true,
        migration,
        seeded: false,
        empty: true,
        message:
          "Đã dựng bảng và xóa sạch dữ liệu. Tạo tài khoản chủ nhà bằng npm run create-owner.",
      });
    }

    if (reset) await clearAll(db);
    if (!reset && (await isSeeded(db))) {
      return Response.json({
        ok: true,
        migration,
        seeded: false,
        message:
          "Đã có dữ liệu, bỏ qua bước nạp mẫu. Gọi lại với ?reset=true để xóa và nạp lại.",
      });
    }

    const counts = await seed(db);
    return Response.json({ ok: true, migration, seeded: true, counts });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
