/**
 * Cổng khóa chung cho các route dựng dữ liệu trong `app/api/dev/`.
 *
 * Mặc định ĐÓNG. Những route này xóa dữ liệu và tạo tài khoản chủ nhà nên
 * không được mở theo kiểu "khác production thì cho chạy": bản build production
 * có `vars` rỗng, biến NODE_ENV không tồn tại, và cách kiểm tra đó sẽ mở route
 * ra Internet.
 *
 * `import.meta.env.DEV` được thay bằng hằng số lúc build nên bản production
 * không thể bật lại. Ngoài dev, cần ĐỦ HAI thứ:
 *
 * 1. Biến `ALLOW_DEV_SETUP=true`.
 * 2. Biến `DEV_SETUP_TOKEN` (ít nhất 24 ký tự) VÀ yêu cầu mang đúng giá trị đó
 *    trong header `x-dev-setup-token`.
 *
 * Lớp thứ hai là để một lần lỡ tay đặt `ALLOW_DEV_SETUP` trên bản chạy thật
 * không tự nó mở đường xóa sạch cơ sở dữ liệu cho cả Internet: người ngoài
 * không có token. `chay-server` và bộ kiểm thử tự sinh token cho mỗi lần chạy.
 */
import { env } from "cloudflare:workers";

const TOKEN_HEADER = "x-dev-setup-token";
const MIN_TOKEN_LENGTH = 24;

function runtimeEnv() {
  return env as unknown as Record<string, string | undefined>;
}

/** So hai chuỗi trong thời gian không phụ thuộc vị trí ký tự sai đầu tiên. */
function sameSecret(given: string, expected: string) {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Công tắc `ALLOW_DEV_SETUP` có đang bật không, bất kể token.
 *
 * Dành cho `/api/dev/status`: script kiểm tra sau deploy cần biết công tắc
 * đang bật để báo người vận hành gỡ đi, dù người ngoài chưa dùng được.
 */
export function isDevSetupConfigured() {
  return import.meta.env.DEV || runtimeEnv().ALLOW_DEV_SETUP === "true";
}

export function isDevSetupEnabled(request: Request) {
  if (import.meta.env.DEV) return true;

  const vars = runtimeEnv();
  if (vars.ALLOW_DEV_SETUP !== "true") return false;

  const token = vars.DEV_SETUP_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH) return false;
  return sameSecret(request.headers.get(TOKEN_HEADER) ?? "", token);
}

export function devSetupLocked() {
  return Response.json(
    { error: "Route này bị khóa ngoài môi trường phát triển." },
    { status: 403 },
  );
}
