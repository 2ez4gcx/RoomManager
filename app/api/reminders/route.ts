import {
  dismissReminder,
  generateReminders,
  listReminders,
  markReminderSent,
} from "../../../db/reminders";
import { requireApiUser, toErrorResponse } from "../../lib/api";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const includeSent = new URL(request.url).searchParams.get("includeSent") === "true";
    return Response.json({ reminders: await listReminders({ includeSent }) });
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
