import { requireOwner, toErrorResponse, toNumber } from "../../lib/api";
import { createProperty } from "../../../db/mutations";
import { listProperties } from "../../../db/queries";

export async function GET() {
  try {
    await requireOwner();
    return Response.json({ properties: await listProperties() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Thêm nhà là thay đổi cấu trúc tài sản, chỉ chủ nhà được làm.
    await requireOwner();

    const body = (await request.json()) as Record<string, unknown>;
    const rawTypes = Array.isArray(body.roomTypes) ? body.roomTypes : [];

    const property = await createProperty({
      name: String(body.name ?? ""),
      code: String(body.code ?? ""),
      address: body.address ? String(body.address) : "",
      roomTypes: rawTypes
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry) => String(entry.name ?? "").trim())
        .map((entry) => ({
          name: String(entry.name),
          basePrice: toNumber(entry.basePrice) ?? 0,
          area: toNumber(entry.area) ?? 0,
          maxOccupants: toNumber(entry.maxOccupants) ?? 2,
        })),
    });

    return Response.json({ property }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
