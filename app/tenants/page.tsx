import { requireUser } from "../lib/session";
import { listRooms, listTenants } from "../../db/queries";
import { TenantsClient } from "./TenantsClient";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const user = await requireUser();
  const [tenants, rooms] = await Promise.all([listTenants(), listRooms()]);

  // Phòng "Đã giữ" cũng được chọn: giữ chỗ chính là bước trước khi ký hợp đồng,
  // và ký xong thì chỗ giữ tự được giải phóng. Phòng đang thuê hoặc đang bảo
  // trì thì không.
  const availableRooms = rooms.filter(
    (room) => room.status === "Trống" || room.status === "Đã giữ",
  );

  return <TenantsClient tenants={tenants} vacantRooms={availableRooms} currentUser={user} />;
}
