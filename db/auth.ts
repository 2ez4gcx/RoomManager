/**
 * Băm mật khẩu và quản lý phiên đăng nhập.
 *
 * Workers không chạy được bcrypt/argon2 (là mã native), nên dùng PBKDF2 của Web
 * Crypto — có sẵn trong runtime và đủ an toàn cho quy mô này.
 */
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { sessions, users } from "./schema";
import { MIN_PASSWORD_LENGTH } from "../app/lib/auth-constants";

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Phiên sống 30 ngày kể từ lần đăng nhập. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "rm_session";

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Trả về chuỗi `pbkdf2$<vòng lặp>$<muối>$<băm>` để lưu vào `users.password_hash`. */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** So sánh theo thời gian hằng số để không lộ thông tin qua thời gian phản hồi. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;

  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;

  const candidate = await derive(password, fromBase64(salt), Number(iterations));
  return timingSafeEqual(candidate, fromBase64(hash));
}

/** Băm token trước khi lưu, để bảng `sessions` không chứa bí mật dùng được. */
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64(new Uint8Array(digest));
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: "owner" | "staff";
};

/** Tạo phiên mới, trả về token thô để đặt vào cookie. Token không được lưu lại. */
export async function createSession(userId: string, userAgent = "") {
  const db = getDb();
  const token = `${newId("ses")}.${toBase64(crypto.getRandomValues(new Uint8Array(24)))}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: await hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent.slice(0, 200),
  });

  // Dọn phiên hết hạn nhân tiện, tránh phải chạy cron riêng.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, await hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.isActive) return null;
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, await hashToken(token)));
}

export class PasswordError extends Error {
  readonly field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = "PasswordError";
    this.field = field;
  }
}

/**
 * Đổi mật khẩu của chính người đang đăng nhập.
 *
 * Bắt nhập lại mật khẩu hiện tại: nếu ai đó chiếm được phiên đăng nhập thì
 * vẫn không đổi được mật khẩu để khóa chủ tài khoản ra ngoài.
 *
 * Đổi xong thì hủy mọi phiên khác của tài khoản này, chỉ giữ phiên đang thao
 * tác. Đây là điểm chính của việc đổi mật khẩu: người lạ đang đăng nhập ở máy
 * khác phải bị đẩy ra.
 */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  /** Token của phiên đang dùng, để không tự đăng xuất chính mình. */
  keepToken?: string;
}) {
  const db = getDb();

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(
      `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
      "newPassword",
    );
  }
  if (input.newPassword === input.currentPassword) {
    throw new PasswordError("Mật khẩu mới phải khác mật khẩu hiện tại.", "newPassword");
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) throw new PasswordError("Không tìm thấy tài khoản.", "currentPassword");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new PasswordError("Mật khẩu hiện tại không đúng.", "currentPassword");
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(users.id, user.id));

  const keepId = input.keepToken ? await hashToken(input.keepToken) : null;
  await db
    .delete(sessions)
    .where(
      keepId
        ? and(eq(sessions.userId, user.id), ne(sessions.id, keepId))
        : eq(sessions.userId, user.id),
    );

  return { ok: true };
}

/**
 * Tra tài khoản theo định danh đăng nhập.
 *
 * Cột `users.email` chứa email với tài khoản thật, nhưng cũng nhận tên đăng
 * nhập ngắn (ví dụ tài khoản chạy thử). Chuẩn hóa về chữ thường để người dùng
 * gõ hoa/thường kiểu gì cũng vào được.
 */
export async function findUserByLogin(login: string) {
  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, login.trim().toLowerCase()))
    .limit(1);
  return user ?? null;
}
