/**
 * Chặn dò mật khẩu ở trang đăng nhập.
 *
 * Đếm số lần sai trong một cửa sổ thời gian trượt. Hết cửa sổ thì tự hết khóa,
 * không cần ai mở khóa thủ công — quan trọng với hệ thống một chủ nhà, vì khóa
 * vĩnh viễn mà không có kênh khôi phục thì chính chủ cũng chịu.
 *
 * Có hai ngưỡng:
 *
 * 1. Theo cặp (định danh + IP): chặn dò mật khẩu của một tài khoản cụ thể.
 *    Cố ý KHÔNG khóa theo riêng tài khoản, vì khi đó người ngoài chỉ cần biết
 *    email của chủ nhà là nhập sai liên tục để khóa chủ nhà ra khỏi hệ thống.
 *    Gắn thêm IP thì kẻ tấn công không làm phiền được người dùng thật.
 *
 * 2. Theo IP: chặn kiểu rải một mật khẩu phổ biến lên nhiều tài khoản từ cùng
 *    một máy — kiểu tấn công mà ngưỡng thứ nhất không bắt được.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { loginAttempts } from "./schema";

/** Cửa sổ đếm, tính bằng mili giây. */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** Số lần sai tối đa cho một cặp định danh + IP trong cửa sổ. */
export const MAX_ATTEMPTS_PER_ACCOUNT = 5;

/** Số lần sai tối đa cho một IP trong cửa sổ, tính trên mọi định danh. */
export const MAX_ATTEMPTS_PER_IP = 20;

export type ThrottleState = {
  blocked: boolean;
  /** Số giây còn phải chờ; 0 khi chưa bị chặn. */
  retryAfterSeconds: number;
  /** Số lần thử còn lại trước khi bị chặn. */
  remaining: number;
};

/**
 * Lấy IP của người gọi.
 *
 * Trên Cloudflare, `cf-connecting-ip` do chính hạ tầng đặt nên tin được.
 * `x-forwarded-for` chỉ dùng khi chạy sau reverse proxy khác; giá trị này khách
 * tự đặt được nên chỉ là phương án dự phòng.
 */
export function clientIp(request: Request) {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) return direct;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "local";
}

function windowStart() {
  return new Date(Date.now() - THROTTLE_WINDOW_MS);
}

/**
 * Ghi nhận lần thử rồi đếm lại, trả về trạng thái chặn.
 *
 * Cố ý GHI TRƯỚC khi đếm. Nếu đếm trước rồi mới ghi thì một loạt yêu cầu gửi
 * song song đều đọc được bộ đếm cũ và cùng lọt qua, tức là bắn đồng thời sẽ
 * lách được giới hạn. Ghi trước làm mỗi yêu cầu tự tính cả chính nó, nên cụm
 * yêu cầu song song tự chặn lẫn nhau.
 *
 * Lần thử thành công cũng được ghi, nhưng bị xóa ngay sau đó bằng
 * `clearLoginFailures`, nên bảng không phình theo lượng đăng nhập bình thường.
 */
export async function registerAttempt(
  identifier: string,
  ip: string,
): Promise<ThrottleState> {
  const db = getDb();
  const key = identifier.trim().toLowerCase();

  await db.insert(loginAttempts).values({ id: newId("att"), identifier: key, ip });

  // Dọn bản ghi đã ra ngoài cửa sổ, tránh phải chạy cron riêng.
  // Dùng toán tử `lt` chứ không viết `sql` thô: cột lưu epoch millisecond nên
  // đối tượng Date phải được Drizzle chuyển kiểu, D1 không bind Date trực tiếp.
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, windowStart()));

  const since = windowStart();

  const [perAccount] = await db
    .select({
      count: sql<number>`count(*)`,
      oldest: sql<number>`min(${loginAttempts.createdAt})`,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, key),
        eq(loginAttempts.ip, ip),
        gte(loginAttempts.createdAt, since),
      ),
    );

  const [perIp] = await db
    .select({
      count: sql<number>`count(*)`,
      oldest: sql<number>`min(${loginAttempts.createdAt})`,
    })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gte(loginAttempts.createdAt, since)))
    .limit(1);

  const accountCount = Number(perAccount?.count ?? 0);
  const ipCount = Number(perIp?.count ?? 0);

  // So sánh `>` chứ không phải `>=`: bản ghi của chính lần thử này đã nằm
  // trong bộ đếm, nên MAX_ATTEMPTS_PER_ACCOUNT vẫn đúng nghĩa "cho phép sai
  // ngần này lần rồi mới khóa".
  const accountBlocked = accountCount > MAX_ATTEMPTS_PER_ACCOUNT;
  const ipBlocked = ipCount > MAX_ATTEMPTS_PER_IP;

  if (!accountBlocked && !ipBlocked) {
    return {
      blocked: false,
      retryAfterSeconds: 0,
      remaining: Math.max(MAX_ATTEMPTS_PER_ACCOUNT - accountCount, 0),
    };
  }

  // Hết khóa khi lần sai cũ nhất trong cửa sổ trôi ra ngoài cửa sổ.
  const oldest = Number(
    (accountBlocked ? perAccount?.oldest : perIp?.oldest) ?? Date.now(),
  );
  const unlockAt = oldest + THROTTLE_WINDOW_MS;

  return {
    blocked: true,
    retryAfterSeconds: Math.max(Math.ceil((unlockAt - Date.now()) / 1000), 1),
    remaining: 0,
  };
}

/** Đăng nhập đúng thì xóa lịch sử sai của chính cặp đó. */
export async function clearLoginFailures(identifier: string, ip: string) {
  const db = getDb();
  await db
    .delete(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier.trim().toLowerCase()),
        eq(loginAttempts.ip, ip),
      ),
    );
}

/** "90 giây" hoặc "3 phút" — dùng trong thông báo cho người dùng. */
export function formatWait(seconds: number) {
  if (seconds < 90) return `${seconds} giây`;
  return `${Math.ceil(seconds / 60)} phút`;
}
