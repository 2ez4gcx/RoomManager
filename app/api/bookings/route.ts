import { requireApiUser, toErrorResponse } from "../../lib/api";
import { setBookingStatus, type BookingStatusValue } from "../../../db/bookings";
import { listBookingRequests } from "../../../db/queries-extra";

const ALLOWED: BookingStatusValue[] = ["new", "contacted", "confirmed", "rejected"];

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ bookings: await listBookingRequests() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();

    const body = (await request.json()) as { id?: string; status?: string };
    const status = body.status as BookingStatusValue;
    if (!ALLOWED.includes(status)) {
      return Response.json({ error: "Trạng thái không hợp lệ." }, { status: 400 });
    }

    const updated = await setBookingStatus(String(body.id ?? ""), status, user.id);
    return Response.json({ booking: { id: updated.id, status: updated.status } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
