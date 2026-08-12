/**
 * Dựng bảng và nạp dữ liệu mẫu cho D1 cục bộ.
 *
 * Chỉ dùng khi phát triển. Trên môi trường thật, control plane đã áp migration
 * lúc deploy và dữ liệu là dữ liệu thật của chủ nhà, nên route này tự khóa lại
 * trừ khi được bật rõ ràng bằng biến môi trường `ALLOW_DEV_SETUP`.
 */
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { applyMigrations } from "../../../../db/migrate";
import { clearAll, isSeeded, seed } from "../../../../db/seed";

/**
 * Mặc định ĐÓNG. Route này xóa và ghi đè dữ liệu nên không được mở theo kiểu
 * "khác production thì cho chạy": bản build production có `vars` rỗng, biến
 * NODE_ENV không tồn tại, và cách kiểm tra đó sẽ mở route ra Internet.
 *
 * `import.meta.env.DEV` được thay bằng hằng số lúc build nên bản production
 * không thể bật lại; ngoài dev phải khai báo `ALLOW_DEV_SETUP=true` một cách
 * cố ý.
 */
function isEnabled() {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return import.meta.env.DEV || runtimeEnv.ALLOW_DEV_SETUP === "true";
}

export async function POST(request: Request) {
  if (!isEnabled()) {
    return Response.json(
      { error: "Route này bị khóa ngoài môi trường phát triển." },
      { status: 403 },
    );
  }

  const reset = new URL(request.url).searchParams.get("reset") === "true";

  try {
    const db = getDb();
    const migration = await applyMigrations(db);

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
