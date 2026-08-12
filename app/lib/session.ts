import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "../../db/auth";

/** Người dùng của phiên hiện tại, hoặc null nếu chưa đăng nhập. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Bắt buộc đăng nhập cho một trang quản trị.
 *
 * `proxy.ts` đã chặn sẵn ở tầng điều hướng, nhưng đó chỉ là kiểm tra cookie có
 * tồn tại hay không. Đây mới là chỗ xác thực thật với cơ sở dữ liệu, và mọi
 * trang đọc dữ liệu riêng tư đều phải gọi.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
