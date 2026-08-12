import { requireOwner, toErrorResponse, toNumber } from "../../lib/api";
import { createRoomType } from "../../../db/mutations";
import { listRoomTypes } from "../../../db/queries";

export async function GET() {
  try {
    await requireOwner();
    return Response.json({ roomTypes: await listRoomTypes() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireOwner();

    const body = (await request.json()) as Record<string, unknown>;
    const roomType = await createRoomType({
      propertyId: String(body.propertyId ?? ""),
      name: String(body.name ?? ""),
      basePrice: toNumber(body.basePrice) ?? 0,
      area: toNumber(body.area) ?? 0,
      maxOccupants: toNumber(body.maxOccupants) ?? 2,
    });

    return Response.json({ roomType }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
