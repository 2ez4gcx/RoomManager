import { requireUser } from "../lib/session";
import { listReminders } from "../../db/reminders";
import { RemindersClient } from "./RemindersClient";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const user = await requireUser();
  const [pending, history] = await Promise.all([
    listReminders(),
    listReminders({ includeSent: true }),
  ]);

  return (
    <RemindersClient
      pending={pending}
      // Chỉ giữ phần đã nhắc; danh sách chưa nhắc đã có ở trên.
      history={history.filter((item) => item.sentAt).slice(0, 50)}
      currentUser={user}
      pendingCount={pending.length}
    />
  );
}
