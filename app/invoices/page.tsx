import { requireUser } from "../lib/session";
import { invoiceSummary, listInvoices } from "../../db/queries-extra";
import { InvoicesClient } from "./InvoicesClient";
import { todayInVietnam } from "../../db/internal";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const period = params.period ?? todayInVietnam().slice(0, 7);

  const [invoices, summary] = await Promise.all([
    listInvoices(period),
    invoiceSummary(period),
  ]);

  return <InvoicesClient invoices={invoices} summary={summary} currentUser={user} />;
}
