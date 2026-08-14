import { resolveResetToken } from "../../db/password-reset";
import { ResetPasswordClient } from "./ResetPasswordClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Đặt lại mật khẩu — RoomManager" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  // Kiểm tra ngay khi mở trang để báo link hỏng trước, thay vì để người dùng
  // gõ xong mật khẩu mới biết.
  const info = await resolveResetToken(token);

  return <ResetPasswordClient token={token} valid={info.valid} fullName={info.fullName} />;
}
