/**
 * Cổng khóa chung cho các route dựng dữ liệu trong `app/api/dev/`.
 *
 * Mặc định ĐÓNG. Những route này xóa dữ liệu và tạo tài khoản chủ nhà nên
 * không được mở theo kiểu "khác production thì cho chạy": bản build production
 * có `vars` rỗng, biến NODE_ENV không tồn tại, và cách kiểm tra đó sẽ mở route
 * ra Internet.
 *
 * `import.meta.env.DEV` được thay bằng hằng số lúc build nên bản production
 * không thể bật lại; ngoài dev phải khai báo `ALLOW_DEV_SETUP=true` một cách
 * cố ý.
 */
import { env } from "cloudflare:workers";

export function isDevSetupEnabled() {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return import.meta.env.DEV || runtimeEnv.ALLOW_DEV_SETUP === "true";
}

export function devSetupLocked() {
  return Response.json(
    { error: "Route này bị khóa ngoài môi trường phát triển." },
    { status: 403 },
  );
}
