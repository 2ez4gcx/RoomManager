import { billingPreview, issueInvoices } from "../../../db/billing";
import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const period = new URL(request.url).searchParams.get("period") ?? currentPeriod();
    return Response.json(await billingPreview(period));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Nhân viên cũng chốt sổ được: đây là việc vận hành hằng tháng, không phải
    // thay đổi cấu trúc tài sản hay bảng giá.
    const user = await requireApiUser();
    const body = (await request.json()) as Record<string, unknown>;
    const entries = Array.isArray(body.entries) ? body.entries : [];

    const result = await issueInvoices({
      period: String(body.period ?? currentPeriod()),
      actorId: user.id,
      entries: entries.map((raw) => {
        const entry = raw as Record<string, unknown>;
        return {
          contractId: String(entry.contractId ?? ""),
          currentReading: toNumber(entry.currentReading),
          occupants: toNumber(entry.occupants),
          rent: toNumber(entry.rent),
        };
      }),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
