/**
 * Điểm nhận yêu cầu đặt phòng từ trang công khai.
 *
 * Route này KHÔNG yêu cầu đăng nhập (xem danh sách công khai trong `proxy.ts`),
 * nên chỉ được ghi vào `booking_requests` và không bao giờ trả về dữ liệu khách
 * thuê. Không có handler GET: danh sách yêu cầu là dữ liệu riêng tư, đọc qua
 * `/api/bookings` sau khi đăng nhập.
 */
import { toErrorResponse, toNumber } from "../../lib/api";
import { createBookingRequest } from "../../../db/bookings";
import { clientIp, formatWait, registerBookingSubmission } from "../../../db/login-throttle";

export async function POST(request: Request) {
  try {
    const throttle = await registerBookingSubmission(clientIp(request));
    if (throttle.blocked) {
      return Response.json(
        {
          error: `Bạn gửi quá nhiều yêu cầu. Thử lại sau ${formatWait(throttle.retryAfterSeconds)}.`,
        },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;

    await createBookingRequest({
      fullName: String(body.fullName ?? ""),
      phone: String(body.phone ?? ""),
      email: body.email ? String(body.email) : null,
      roomId: body.roomId ? String(body.roomId) : null,
      preferredMoveIn: body.preferredMoveIn ? String(body.preferredMoveIn) : null,
      occupants: toNumber(body.occupants) ?? 1,
      message: body.message ? String(body.message) : "",
    });

    // Cố ý không trả về id hay mã yêu cầu: người gửi không cần, và trả ra thì
    // người ngoài dò được số lượng yêu cầu đã nhận.
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
