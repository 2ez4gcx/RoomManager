import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { createLedgerEntry } from "../../../db/finance";
import { listLedgerEntries } from "../../../db/queries";

export async function GET(request: Request) {
  try {
    await requireApiUser();

    // Mặc định 30 dòng cho màn hình; cho phép lấy nhiều hơn khi cần cộng sổ.
    const raw = toNumber(new URL(request.url).searchParams.get("limit"));
    const limit = raw && raw > 0 ? Math.min(raw, 1000) : 30;

    return Response.json({ entries: await listLedgerEntries(limit) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();

    const body = (await request.json()) as Record<string, unknown>;
    const result = await createLedgerEntry({
      direction: body.direction === "out" ? "out" : "in",
      category: String(body.category ?? ""),
      description: body.description ? String(body.description) : "",
      amount: toNumber(body.amount) ?? 0,
      occurredAt: body.occurredAt ? String(body.occurredAt) : undefined,
      propertyId: body.propertyId ? String(body.propertyId) : null,
      actorId: user.id,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
