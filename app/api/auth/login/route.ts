import {
  createSession,
  findUserByLogin,
  hashPassword,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyPassword,
} from "../../../../db/auth";
import {
  clearLoginFailures,
  clientIp,
  discardAttempt,
  formatWait,
  registerAttempt,
} from "../../../../db/login-throttle";
import { consumeSecondFactor } from "../../../../db/two-factor";

/**
 * Thông điệp lỗi cố tình chung chung: không nói email có tồn tại hay không, để
 * không giúp người ngoài dò danh sách tài khoản.
 */
const INVALID = "Email hoặc mật khẩu không đúng.";

/**
 * Băm giả để so khi không tìm thấy tài khoản.
 *
 * Không có bước này thì đăng nhập vào tài khoản không tồn tại trả lời gần như
 * tức thì, còn tài khoản có thật mất thời gian chạy PBKDF2 — chênh lệch đó đủ
 * để dò xem tài khoản nào tồn tại. Tính một lần rồi dùng lại cho mọi yêu cầu.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash() {
  dummyHashPromise ??= hashPassword(crypto.randomUUID());
  return dummyHashPromise;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      code?: string;
    };
    const login = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const code = String(body.code ?? "").trim();

    if (!login || !password) {
      return Response.json({ error: INVALID }, { status: 400 });
    }

    const ip = clientIp(request);

    // Ghi nhận và kiểm tra TRƯỚC khi băm mật khẩu: đã bị chặn thì không tốn CPU.
    const throttle = await registerAttempt(login, ip);
    if (throttle.blocked) {
      return Response.json(
        {
          error: `Đã nhập sai quá nhiều lần. Thử lại sau ${formatWait(throttle.retryAfterSeconds)}.`,
          retryAfterSeconds: throttle.retryAfterSeconds,
        },
        { status: 429, headers: { "retry-after": String(throttle.retryAfterSeconds) } },
      );
    }

    const user = await findUserByLogin(login);
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));

    if (!user || !user.isActive || !ok) {
      // Lần thử này đã được ghi ở registerAttempt, không ghi lại lần nữa.
      const left = throttle.remaining;
      return Response.json(
        {
          error:
            left > 0 && left <= 2
              ? `${INVALID} Còn ${left} lần thử trước khi tạm khóa.`
              : INVALID,
        },
        { status: 401 },
      );
    }

    // Mật khẩu đúng. Nếu tài khoản bật xác thực hai bước thì chưa cấp phiên.
    if (user.totpEnabledAt && user.totpSecret) {
      if (!code) {
        // Chưa nhập mã thì không tính là đăng nhập sai, gỡ bản ghi vừa tạo.
        await discardAttempt(throttle.attemptId);
        return Response.json(
          { needsTotp: true, error: "Nhập mã xác thực hai bước để tiếp tục." },
          { status: 401 },
        );
      }

      const accepted = await consumeSecondFactor(
        user.id,
        user.totpSecret,
        user.totpLastCounter,
        code,
      );
      if (!accepted) {
        return Response.json(
          { needsTotp: true, error: "Mã xác thực không đúng hoặc đã dùng rồi." },
          { status: 401 },
        );
      }
    }

    await clearLoginFailures(login, ip);

    const { token } = await createSession(user.id, request.headers.get("user-agent") ?? "");
    const secure = new URL(request.url).protocol === "https:";

    return Response.json(
      { ok: true, user: { fullName: user.fullName, role: user.role } },
      {
        status: 200,
        headers: {
          "set-cookie": [
            `${SESSION_COOKIE}=${token}`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
            secure ? "Secure" : "",
          ]
            .filter(Boolean)
            .join("; "),
        },
      },
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
