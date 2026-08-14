import { endContract, moveOutPreview } from "../../../db/move-out";
import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const contractId = new URL(request.url).searchParams.get("contractId") ?? "";
    return Response.json(await moveOutPreview(contractId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Trả phòng là việc vận hành hằng ngày, nhân viên làm được.
    const user = await requireApiUser();
    const body = (await request.json()) as Record<string, unknown>;

    const result = await endContract({
      contractId: String(body.contractId ?? ""),
      endDate: String(body.endDate ?? ""),
      reason: body.reason ? String(body.reason) : "",
      deductions: toNumber(body.deductions) ?? 0,
      deductionNote: body.deductionNote ? String(body.deductionNote) : "",
      actorId: user.id,
    });

    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
