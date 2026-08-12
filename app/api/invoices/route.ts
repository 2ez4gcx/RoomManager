import { requireApiUser, toErrorResponse } from "../../lib/api";
import { invoiceSummary, listInvoices } from "../../../db/queries-extra";

export async function GET(request: Request) {
  try {
    await requireApiUser();

    const period =
      new URL(request.url).searchParams.get("period") ??
      new Date().toISOString().slice(0, 7);

    const [invoices, summary] = await Promise.all([
      listInvoices(period),
      invoiceSummary(period),
    ]);

    return Response.json({ invoices, summary });
  } catch (error) {
    return toErrorResponse(error);
  }
}
