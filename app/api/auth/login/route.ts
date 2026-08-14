import {
  createSession,
  findUserByLogin,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyPassword,
} from "../../../../db/auth";

/**
 * Thông điệp lỗi cố tình chung chung: không nói email có tồn tại hay không, để
 * không giúp người ngoài dò danh sách tài khoản.
 */
const INVALID = "Email hoặc mật khẩu không đúng.";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return Response.json({ error: INVALID }, { status: 400 });
    }

    const user = await findUserByLogin(email);
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !user.isActive || !ok) {
      return Response.json({ error: INVALID }, { status: 401 });
    }

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
