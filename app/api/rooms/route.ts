import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { createRoom } from "../../../db/mutations";
import { listRooms } from "../../../db/queries";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ rooms: await listRooms() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();

    const body = (await request.json()) as Record<string, unknown>;
    const room = await createRoom({
      actorId: user.id,
      propertyId: String(body.propertyId ?? ""),
      roomTypeId: String(body.roomTypeId ?? ""),
      number: String(body.number ?? ""),
      floor: toNumber(body.floor) ?? 1,
      price: toNumber(body.price),
      area: toNumber(body.area),
      note: body.note ? String(body.note) : "",
    });

    return Response.json({ room }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
