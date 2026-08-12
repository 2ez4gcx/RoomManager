import { DashboardClient } from "./DashboardClient";
import { requireUser } from "./lib/session";
import { dashboardSummary, listRooms } from "../db/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const [summary, rooms] = await Promise.all([dashboardSummary(), listRooms()]);
  return <DashboardClient summary={summary} rooms={rooms} currentUser={user} />;
}
