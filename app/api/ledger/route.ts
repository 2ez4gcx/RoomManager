import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { createLedgerEntry } from "../../../db/finance";
import { listLedgerEntries } from "../../../db/queries";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ entries: await listLedgerEntries() });
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
