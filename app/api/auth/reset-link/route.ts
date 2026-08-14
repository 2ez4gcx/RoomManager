/**
 * Chủ nhà cấp link đặt lại mật khẩu cho một tài khoản.
 *
 * `/api/auth/` được `proxy.ts` cho qua nên route tự kiểm tra quyền.
 */
import { createResetToken } from "../../../../db/password-reset";
import { requireOwner, toErrorResponse } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    const actor = await requireOwner();
    const body = (await request.json()) as { userId?: string };

    const result = await createResetToken({
      userId: String(body.userId ?? ""),
      actorId: actor.id,
    });

    // Trả về đường dẫn tương đối; giao diện tự ghép với tên miền đang mở, để
    // không phải cấu hình sẵn địa chỉ công khai ở phía máy chủ.
    return Response.json(
      {
        path: `/dat-lai-mat-khau?token=${encodeURIComponent(result.token)}`,
        expiresAt: result.expiresAt,
        user: result.user,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
