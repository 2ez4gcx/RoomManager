import { requireUser } from "../lib/session";
import { billingPreview } from "../../db/billing";
import { BillingClient } from "./BillingClient";
import { todayInVietnam } from "../../db/internal";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const period = params.period ?? todayInVietnam().slice(0, 7);

  return <BillingClient preview={await billingPreview(period)} currentUser={user} />;
}
