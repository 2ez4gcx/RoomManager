/**
 * Bật/tắt xác thực hai bước cho chính người đang đăng nhập.
 *
 * Không có thao tác nào cho phép bật hộ hay tắt hộ người khác: 2FA gắn với
 * điện thoại của từng người, chủ nhà cũng không thao tác thay được.
 */
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  twoFactorStatus,
} from "../../../../db/two-factor";
import { requireApiUser, toErrorResponse } from "../../../lib/api";

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json(await twoFactorStatus(user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Bước 1: sinh khóa. Chưa bật gì. */
export async function POST() {
  try {
    const user = await requireApiUser();
    return Response.json(await beginTwoFactorSetup(user.id), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Bước 2: xác nhận bằng mã đúng rồi mới bật, trả về mã khôi phục. */
export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as { code?: string };
    return Response.json(await confirmTwoFactorSetup(user.id, String(body.code ?? "")));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as { code?: string };
    return Response.json(await disableTwoFactor(user.id, String(body.code ?? "")));
  } catch (error) {
    return toErrorResponse(error);
  }
}
