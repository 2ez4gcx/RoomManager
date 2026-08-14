/**
 * Đặt mật khẩu mới bằng link.
 *
 * Route công khai — người dùng chưa đăng nhập được nên mới cần tới nó. Quyền
 * nằm ở chính token trong link: khó đoán, hết hạn sau một giờ, dùng một lần.
 *
 * Cố ý KHÔNG cấp phiên đăng nhập sau khi đặt lại. Người dùng phải đăng nhập
 * bình thường, nhờ vậy tài khoản có bật xác thực hai bước vẫn bị hỏi mã.
 */
import { completeReset, resolveResetToken } from "../../../../db/password-reset";
import { toErrorResponse } from "../../../lib/api";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    return Response.json(await resolveResetToken(token));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const newPassword = String(body.newPassword ?? "");
    if (newPassword !== String(body.confirmPassword ?? "")) {
      return Response.json(
        { error: "Hai lần nhập mật khẩu mới không khớp.", field: "confirmPassword" },
        { status: 400 },
      );
    }

    return Response.json(
      await completeReset({ token: String(body.token ?? ""), newPassword }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
