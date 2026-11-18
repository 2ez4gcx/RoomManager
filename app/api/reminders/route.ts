import {
  dismissReminder,
  generateReminders,
  listReminders,
  markReminderSent,
} from "../../../db/reminders";
import { isRealDate } from "../../../db/internal";
import { requireApiUser, toErrorResponse } from "../../lib/api";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const params = new URL(request.url).searchParams;
    const includeSent = params.get("includeSent") === "true";
    // Xem danh sách tại một ngày cụ thể, đi cặp với `today` của POST bên dưới.
    const today = params.get("today") ?? "";
    return Response.json({
      reminders: await listReminders({
        includeSent,
        today: /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : undefined,
      }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Rà lại ngay lập tức.
 *
 * Bình thường việc này do cron chạy mỗi sáng; nút bấm tay dùng khi vừa lập đơn
 * xong và muốn thấy danh sách ngay.
 */
export async function POST(request: Request) {
  try {
    await requireApiUser();
    const body = (await request.json().catch(() => ({}))) as { today?: string };
    if (body.today !== undefined && !isRealDate(String(body.today))) {
      return Response.json({ error: "Ngày không hợp lệ.", field: "today" }, { status: 400 });
    }
    return Response.json(await generateReminders(body.today));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as { id?: string; channel?: string };
    const reminderId = String(body.id ?? "");

    if (body.channel === "bo_qua") {
      return Response.json(await dismissReminder({ reminderId, actorId: user.id }));
    }

    return Response.json(
      await markReminderSent({
        reminderId,
        channel: String(body.channel ?? ""),
        actorId: user.id,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
