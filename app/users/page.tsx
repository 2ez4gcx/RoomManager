import { redirect } from "next/navigation";
import { requireUser } from "../lib/session";
import { listUsers } from "../../db/users";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireUser();
  // Nhân viên không xem được danh sách tài khoản; đẩy về trang chủ thay vì
  // hiện trang trống.
  if (user.role !== "owner") redirect("/");

  return <UsersClient users={await listUsers()} currentUser={user} />;
}
