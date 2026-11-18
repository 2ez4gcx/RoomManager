/**
 * Sinh mã TOTP để kiểm thử tự động đóng vai ứng dụng xác thực.
 *
 * Khóa cùng cổng chặn với `/api/dev/setup`: mặc định đóng, bản production chỉ
 * mở khi khai báo `ALLOW_DEV_SETUP`. Route này không đọc khóa của ai trong cơ
 * sở dữ liệu — người gọi phải tự đưa khóa vào — nên không lộ 2FA của tài khoản
 * nào, nhưng vẫn không nên để mở ngoài môi trường phát triển.
 */
import { currentCounter, generateTotpCode, toBase32 } from "../../../../db/totp";
import { devSetupLocked, isDevSetupEnabled } from "../../../lib/dev-setup";


/** Khóa mẫu "12345678901234567890" trong phụ lục B của RFC 6238. */
const RFC_SECRET = toBase32(new TextEncoder().encode("12345678901234567890"));
const RFC_TIMES = [59, 1111111109, 1234567890, 2000000000];

export async function GET(request: Request) {
  if (!isDevSetupEnabled(request)) return devSetupLocked();

  const params = new URL(request.url).searchParams;

  if (params.get("rfc")) {
    const results = await Promise.all(
      RFC_TIMES.map(async (time) => ({
        time,
        code: await generateTotpCode(RFC_SECRET, currentCounter(time * 1000)),
      })),
    );
    return Response.json({ results });
  }

  const secret = params.get("secret");
  if (!secret) return Response.json({ error: "Thiếu tham số secret." }, { status: 400 });

  const offset = Number(params.get("offset") ?? 0);
  return Response.json({
    code: await generateTotpCode(secret, currentCounter() + (Number.isFinite(offset) ? offset : 0)),
  });
}
