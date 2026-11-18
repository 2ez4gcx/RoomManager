/**
 * Kiểm tra một chuỗi băm mật khẩu, dùng cho kiểm thử tự động.
 *
 * Tồn tại để chứng minh chuỗi băm do `scripts/hash-password.ts` sinh ra ở Node
 * được worker chấp nhận — đó là đường cứu hộ khi chủ nhà duy nhất quên mật
 * khẩu, sai định dạng là khóa vĩnh viễn.
 *
 * Không đọc cơ sở dữ liệu: người gọi tự đưa cả mật khẩu lẫn chuỗi băm, nên
 * route không lộ thông tin của tài khoản nào. Vẫn khóa như các route dev khác.
 */
import { verifyPassword } from "../../../../db/password-hash";
import { devSetupLocked, isDevSetupEnabled } from "../../../lib/dev-setup";


export async function POST(request: Request) {
  if (!isDevSetupEnabled(request)) return devSetupLocked();

  const body = (await request.json()) as { password?: string; hash?: string };
  return Response.json({
    valid: await verifyPassword(String(body.password ?? ""), String(body.hash ?? "")),
  });
}
