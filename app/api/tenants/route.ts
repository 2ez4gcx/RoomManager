import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { createTenant } from "../../../db/mutations";
import { listTenants } from "../../../db/queries";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ tenants: await listTenants() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const body = (await request.json()) as Record<string, unknown>;
    const result = await createTenant({
      fullName: String(body.fullName ?? ""),
      phone: String(body.phone ?? ""),
      idNumber: body.idNumber ? String(body.idNumber) : null,
      dateOfBirth: body.dateOfBirth ? String(body.dateOfBirth) : null,
      roomId: String(body.roomId ?? ""),
      startDate: String(body.startDate ?? ""),
      months: toNumber(body.months) ?? 12,
      rent: toNumber(body.rent),
      deposit: toNumber(body.deposit),
      billingDay: toNumber(body.billingDay) ?? 5,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
