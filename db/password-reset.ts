/**
 * Đặt lại mật khẩu bằng link dùng một lần do chủ nhà cấp.
 *
 * Không gửi email: Cloudflare Workers không mở được kết nối TCP nên không dùng
 * SMTP trực tiếp, mà hệ thống cũng chưa có dịch vụ gửi mail nào. Chủ nhà bấm
 * tạo link rồi chuyển cho người quên mật khẩu qua Zalo hoặc gọi điện.
 *
 * Link KHÔNG tự đăng nhập. Đặt lại xong người dùng vẫn phải đăng nhập bình
 * thường, nên tài khoản có bật xác thực hai bước vẫn bị hỏi mã — nếu link tự
 * cấp phiên thì nó trở thành đường vòng qua 2FA.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hashPassword } from "./auth";
import { getDb } from "./index";
import { ValidationError, writeAudit } from "./internal";
import { passwordResetTokens, sessions, users } from "./schema";
import { MIN_PASSWORD_LENGTH } from "../app/lib/auth-constants";

/** Link sống một giờ. Đây là thứ ai cầm cũng dùng được nên để ngắn. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Cấp link mới cho một tài khoản.
 *
 * Hủy mọi link chưa dùng của tài khoản đó trước: để nhiều link cùng sống nghĩa
 * là mỗi lần bấm nhầm lại thêm một chìa khóa đang trôi nổi.
 */
export async function createResetToken(input: { userId: string; actorId: string | null }) {
  const db = getDb();

  const [target] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) throw new ValidationError("Không tìm thấy tài khoản.", "userId");
  if (!target.isActive) {
    throw new ValidationError(
      "Tài khoản đang bị khóa. Mở khóa trước rồi mới đặt lại mật khẩu.",
      "userId",
    );
  }

  await db.delete(passwordResetTokens).where(
    and(eq(passwordResetTokens.userId, target.id), isNull(passwordResetTokens.usedAt)),
  );

  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokens).values({
    id: await hashToken(token),
    userId: target.id,
    expiresAt,
    createdBy: input.actorId,
  });

  await writeAudit(db, {
    actorId: input.actorId,
    action: "password.resetLink",
    entityType: "user",
    entityId: target.id,
    changes: { fullName: target.fullName },
  });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: { fullName: target.fullName, email: target.email },
  };
}

export type ResetTokenInfo = {
  valid: boolean;
  fullName: string | null;
  email: string | null;
};

/** Tra link còn dùng được không, để trang đặt lại báo sớm thay vì để người dùng gõ xong mới biết. */
export async function resolveResetToken(token: string): Promise<ResetTokenInfo> {
  if (!token) return { valid: false, fullName: null, email: null };

  const db = getDb();
  const [row] = await db
    .select({ fullName: users.fullName, email: users.email, isActive: users.isActive })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.id, await hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row || !row.isActive) return { valid: false, fullName: null, email: null };
  return { valid: true, fullName: row.fullName, email: row.email };
}

/**
 * Dùng link để đặt mật khẩu mới.
 *
 * Đánh dấu link đã dùng và hủy mọi phiên của tài khoản: người quên mật khẩu
 * thường quên vì máy lạ đang đăng nhập, hoặc vì tài khoản đã bị người khác
 * đụng vào.
 */
export async function completeReset(input: { token: string; newPassword: string }) {
  const db = getDb();

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
      "newPassword",
    );
  }

  const tokenId = await hashToken(input.token);
  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.id, tokenId),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ValidationError(
      "Link đã hết hạn hoặc đã dùng rồi. Nhờ chủ nhà cấp link mới.",
      "token",
    );
  }

  const [account] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!account?.isActive) {
    throw new ValidationError("Tài khoản đang bị khóa.", "token");
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(users.id, row.userId));

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));

  await db.delete(sessions).where(eq(sessions.userId, row.userId));

  await writeAudit(db, {
    actorId: row.userId,
    action: "password.resetCompleted",
    entityType: "user",
    entityId: row.userId,
  });

  return { ok: true };
}
