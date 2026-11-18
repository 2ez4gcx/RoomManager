import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { recordPayment } from "../../../db/finance";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();

    const body = (await request.json()) as Record<string, unknown>;
    const result = await recordPayment({
      invoiceId: String(body.invoiceId ?? ""),
      amount: toNumber(body.amount) ?? 0,
      // Kiểm tra giá trị nằm ở recordPayment; ở đây chỉ chuyển tiếp.
      method: body.method ? (String(body.method) as "cash") : undefined,
      paidAt: body.paidAt ? String(body.paidAt) : undefined,
      note: body.note ? String(body.note) : undefined,
      actorId: user.id,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
