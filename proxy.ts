/**
 * Chặn khu quản trị ở tầng điều hướng.
 *
 * Đây CHỈ là kiểm tra cookie có tồn tại hay không, để người chưa đăng nhập được
 * đưa về trang đăng nhập thay vì thấy trang lỗi. Việc xác thực thật nằm ở
 * `requireUser()` trong từng trang và `requireApiUser()` trong từng route API —
 * không được dựa vào file này để bảo vệ dữ liệu.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "rm_session";

/** Đường dẫn ai cũng vào được. */
const PUBLIC_PREFIXES = [
  "/login",
  // Người quên mật khẩu chưa đăng nhập được nên trang này phải mở. Quyền nằm
  // ở token trong link: khó đoán, hết hạn sau một giờ, dùng một lần.
  "/dat-lai-mat-khau",
  "/booking",
  "/api/auth/",
  // Nhận yêu cầu từ biểu mẫu công khai; route chỉ ghi, không đọc dữ liệu riêng tư.
  "/api/booking-requests",
  // Phải mở ở đây vì cần chạy khi chưa có tài khoản nào. Route tự khóa bằng
  // `import.meta.env.DEV` và `ALLOW_DEV_SETUP`, xem app/api/dev/setup/route.ts.
  "/api/dev/setup",
  // Tạo tài khoản chủ nhà đầu tiên: theo định nghĩa là lúc chưa ai đăng nhập
  // được. Route dùng chung cổng khóa với /api/dev/setup và còn từ chối thêm
  // khi cơ sở dữ liệu đã có tài khoản.
  "/api/dev/create-owner",
  // Chỉ báo nhóm route dev đang mở hay đóng, không làm gì. Phải mở để
  // script kiểm tra sau deploy hỏi được mà không cần đăng nhập.
  "/api/dev/status",
  "/api/dev/verify-hash",
  "/api/dev/totp",
  "/_next",
  "/favicon",
  "/og.png",
];

function isPublic(pathname: string) {
  // `/booking` là trang công khai; `/bookings` là trang quản trị, phải phân biệt.
  if (pathname === "/booking" || pathname.startsWith("/booking/")) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
