/**
 * Cho biết nhóm route `/api/dev/` đang mở hay đóng, mà không làm gì cả.
 *
 * Sinh ra để `scripts/kiem-tra-sau-deploy.mjs` hỏi được. Trước đó script phải
 * POST thẳng vào `/api/dev/setup?reset=true` để xem có bị chặn không — nghĩa
 * là đúng lúc phát hiện ra route đang mở thì nó đã xoá sạch cơ sở dữ liệu
 * rồi. Công cụ đi kiểm tra thảm hoạ không được phép gây ra thảm hoạ.
 *
 * Trả về 403 khi nhóm route đang đóng, 200 khi đang mở. Không lộ gì: ai gọi
 * được và thấy 200 thì cũng gọi được thẳng route thật.
 */
import { devSetupLocked, isDevSetupEnabled } from "../../../lib/dev-setup";

export async function GET() {
  if (!isDevSetupEnabled()) return devSetupLocked();

  return Response.json({
    enabled: true,
    canhBao:
      "Nhóm route /api/dev/ đang mở. Trên môi trường thật, đây là đường xóa sạch cơ sở dữ liệu.",
    routes: [
      "/api/dev/setup",
      "/api/dev/create-owner",
      "/api/dev/verify-hash",
      "/api/dev/totp",
    ],
  });
}
