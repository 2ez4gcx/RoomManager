/**
 * Băm mật khẩu và quản lý phiên đăng nhập.
 *
 * Workers không chạy được bcrypt/argon2 (là mã native), nên dùng PBKDF2 của Web
 * Crypto — có sẵn trong runtime và đủ an toàn cho quy mô này.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { sessions, users } from "./schema";

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

export async function findUserByEmail(email: string) {
  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return user ?? null;
}
