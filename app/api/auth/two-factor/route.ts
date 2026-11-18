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
import {
  clientIp,
  discardAttempt,
  formatWait,
  registerVerificationAttempt,
} from "../../../../db/login-throttle";
import { requireApiUser, toErrorResponse } from "../../../lib/api";

/** Chặn dò mã: đếm lần thử, sai quá ngưỡng thì trả 429. */
async function guardCode(userId: string, request: Request) {
  const guard = await registerVerificationAttempt(userId, clientIp(request));
  if (!guard.blocked) return { attemptId: guard.attemptId, blocked: null };
  return {
    attemptId: guard.attemptId,
    blocked: Response.json(
      { error: `Nhập sai quá nhiều lần. Thử lại sau ${formatWait(guard.retryAfterSeconds)}.` },
      { status: 429, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
    ),
  };
}

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
    const guard = await guardCode(user.id, request);
    if (guard.blocked) return guard.blocked;

    const result = await confirmTwoFactorSetup(user.id, String(body.code ?? ""));
    await discardAttempt(guard.attemptId);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as { code?: string };
    const guard = await guardCode(user.id, request);
    if (guard.blocked) return guard.blocked;

    const result = await disableTwoFactor(user.id, String(body.code ?? ""));
    await discardAttempt(guard.attemptId);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
