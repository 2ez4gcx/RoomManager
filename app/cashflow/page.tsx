import { requireUser } from "../lib/session";
import { listLedgerEntries, listProperties } from "../../db/queries";
import { cashflowSummary } from "../../db/queries-extra";
import { CashflowClient } from "./CashflowClient";

export const dynamic = "force-dynamic";

export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const period = params.period ?? new Date().toISOString().slice(0, 7);

  const [summary, entries, properties] = await Promise.all([
    cashflowSummary(period),
    listLedgerEntries(40),
    listProperties(),
  ]);

  return (
    <CashflowClient
      period={period}
      summary={summary}
      entries={entries}
      properties={properties}
      currentUser={user}
    />
  );
}
