import { requireUser } from "../lib/session";
import { bookingStats, listBookingRequests } from "../../db/queries-extra";
import { BookingsClient } from "./BookingsClient";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const user = await requireUser();
  const [bookings, stats] = await Promise.all([listBookingRequests(), bookingStats()]);

  return <BookingsClient bookings={bookings} stats={stats} currentUser={user} />;
}
