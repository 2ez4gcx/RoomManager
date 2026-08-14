/**
 * Tạo tài khoản chủ nhà đầu tiên cho cơ sở dữ liệu trống ở máy.
 *
 * Trên Cloudflare thì dùng `npm run create-owner` rồi chạy lệnh `wrangler d1
 * execute --remote` mà nó in ra. Ở máy không làm vậy được: `wrangler d1 execute
 * --local` ghi vào một file SQLite khác với file mà `npm run dev` đang mở, nên
 * hàng vừa chèn không hiện ra trong ứng dụng.
 *
 * Route chỉ chạy khi cơ sở dữ liệu **chưa có tài khoản nào**. Đã có một người
 * đăng nhập được thì việc tạo tài khoản phải đi qua trang Tài khoản, nơi có
 * kiểm tra quyền và ghi nhật ký.
 */
import { count } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createUser } from "../../../../db/users";
import { toErrorResponse } from "../../../lib/api";
import { devSetupLocked, isDevSetupEnabled } from "../../../lib/dev-setup";

export async function POST(request: Request) {
  if (!isDevSetupEnabled()) return devSetupLocked();

  try {
    const db = getDb();
    const [{ total }] = await db.select({ total: count() }).from(users);
    if (total > 0) {
      return Response.json(
        {
          error:
            "Đã có tài khoản trong hệ thống. Đăng nhập rồi tạo tài khoản mới ở trang Tài khoản.",
        },
        { status: 409 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const owner = await createUser({
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      phone: body.phone ? String(body.phone) : null,
      password: String(body.password ?? ""),
      role: "owner",
      // Chưa có ai để ghi vào nhật ký; đây là hàng đầu tiên của bảng.
      actorId: null,
    });

    return Response.json({ ok: true, user: owner }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
