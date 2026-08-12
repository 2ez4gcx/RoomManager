import { redirect } from "next/navigation";
import { getCurrentUser } from "../lib/session";
import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Đăng nhập — RoomManager" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <LoginClient />;
}
