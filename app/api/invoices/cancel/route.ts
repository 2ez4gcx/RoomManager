import { cancelInvoice } from "../../../../db/invoice-cancel";
import { requireOwner, toErrorResponse } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    // Hủy đơn là xóa một khoản phải thu khỏi công nợ: chỉ chủ nhà.
    const user = await requireOwner();
    const body = (await request.json()) as { invoiceId?: string; reason?: string };

    return Response.json(
      await cancelInvoice({
        invoiceId: String(body.invoiceId ?? ""),
        reason: String(body.reason ?? ""),
        actorId: user.id,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
