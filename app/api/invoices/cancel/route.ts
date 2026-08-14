import { cancelInvoice } from "../../../../db/invoice-cancel";
import { requireApiUser, toErrorResponse } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
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
