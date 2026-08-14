import { cookies } from "next/headers";
import { changePassword, PasswordError, SESSION_COOKIE } from "../../../../db/auth";
import { requireApiUser, toErrorResponse } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as Record<string, unknown>;

    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");

    if (!currentPassword) {
      return Response.json(
        { error: "Cần nhập mật khẩu hiện tại.", field: "currentPassword" },
        { status: 400 },
      );
    }
    // Kiểm tra lại ở máy chủ, không tin phần đối chiếu phía trình duyệt.
    if (newPassword !== confirmPassword) {
      return Response.json(
        { error: "Hai lần nhập mật khẩu mới không khớp.", field: "confirmPassword" },
        { status: 400 },
      );
    }

    const store = await cookies();
    await changePassword({
      userId: user.id,
      currentPassword,
      newPassword,
      keepToken: store.get(SESSION_COOKIE)?.value,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordError) {
      return Response.json({ error: error.message, field: error.field }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
