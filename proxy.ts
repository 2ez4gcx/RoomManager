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
  // `/booking` (trang công khai) được xét riêng trong isPublic. Để nó ở đây thì
  // phép so tiền tố nhận luôn `/bookings` là công khai.
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

/**
 * Yêu cầu ghi dữ liệu phải đến từ chính trang của ứng dụng.
 *
 * Cookie phiên là `SameSite=Lax`, đủ chặn trang lạ ở tên miền khác. Nhưng khi
 * chạy trên tên miền riêng, một trang ở subdomain anh em (hoặc một dịch vụ
 * khác trên cùng máy trong mạng nội bộ) được trình duyệt coi là "cùng site" và
 * vẫn gửi kèm cookie. Trình duyệt luôn gửi header `Origin` cho yêu cầu ghi từ
 * trang web, nên so nó với `Host` là chặn được. Không có `Origin` (lệnh curl,
 * script) thì cho qua: những nguồn đó không mang cookie của người dùng.
 */
function isCrossOriginWrite(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  // Chấp nhận khi khớp `Host` do trình duyệt gửi, hoặc khớp host của chính URL
  // đang được phục vụ (hai giá trị này lệch nhau khi đứng sau một lớp chuyển tiếp).
  const ownHosts = new Set([request.headers.get("host"), request.nextUrl.host]);
  try {
    return !ownHosts.has(new URL(origin).host);
  } catch {
    return true;
  }
}

/**
 * Header bảo vệ gắn vào mọi phản hồi đi qua đây.
 *
 * - Cấm nhúng ứng dụng vào khung của trang khác, chặn kiểu lừa bấm
 *   (clickjacking) lên các nút thu tiền, hủy đơn.
 * - Cấm trình duyệt đoán kiểu nội dung.
 * - Không gửi địa chỉ trang đi nơi khác. Trang đặt lại mật khẩu mang token
 *   ngay trên URL nên tuyệt đối không gửi Referer.
 */
function withSecurityHeaders(response: NextResponse, pathname: string) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    pathname.startsWith("/dat-lai-mat-khau") ? "no-referrer" : "same-origin",
  );
  return response;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && isCrossOriginWrite(request)) {
    return NextResponse.json(
      { error: "Yêu cầu đến từ một trang khác, không được chấp nhận." },
      { status: 403 },
    );
  }

  if (isPublic(pathname) || request.cookies.get(SESSION_COOKIE)) {
    return withSecurityHeaders(NextResponse.next(), pathname);
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return withSecurityHeaders(NextResponse.redirect(loginUrl), pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
