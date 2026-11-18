/**
 * Bật, tắt và kiểm tra xác thực hai bước.
 *
 * Luồng bật gồm hai bước cố ý: sinh khóa rồi mới xác nhận bằng một mã đúng.
 * Nếu bật ngay lúc sinh khóa, người quét hụt hoặc nhập nhầm sẽ tự khóa mình ra
 * khỏi hệ thống mà không có cách nào vào lại.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { ValidationError, writeAudit } from "./internal";
import { verifyPassword } from "./password-hash";
import { recoveryCodes, users } from "./schema";
import { qrMatrix } from "./qr";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

/** Số mã khôi phục phát mỗi lần bật. */
export const RECOVERY_CODE_COUNT = 8;

const ISSUER = "RoomManager";

/** Bảng ký tự bỏ chữ dễ nhìn nhầm: không có I, L, O, U, 0, 1. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** Băm mã khôi phục. SHA-256 là đủ vì mã do hệ thống sinh, không phải người đặt. */
async function hashCode(code: string) {
  const normalized = code.trim().toUpperCase().replace(/\s/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export type TwoFactorStatus = {
  enabled: boolean;
  /** Đã sinh khóa nhưng chưa xác nhận bằng mã. */
  pending: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
};

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const db = getDb();

  const [user] = await db
    .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ValidationError("Không tìm thấy tài khoản.", "userId");

  const [left] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

  return {
    enabled: user.totpEnabledAt !== null,
    pending: user.totpSecret !== null && user.totpEnabledAt === null,
    enabledAt: user.totpEnabledAt ? user.totpEnabledAt.toISOString() : null,
    recoveryCodesLeft: Number(left?.count ?? 0),
  };
}

/**
 * Bước 1: sinh khóa mới và trả về cho người dùng quét hoặc nhập tay.
 *
 * Chưa bật gì cả. Gọi lại sẽ sinh khóa khác, dùng khi người dùng làm dở giữa
 * chừng rồi bắt đầu lại.
 *
 * Bắt nhập lại mật khẩu. Không có bước này thì ai cầm được một phiên đang mở
 * (máy quên khóa, cookie bị lấy) gắn được ứng dụng xác thực CỦA HỌ vào tài
 * khoản: chủ tài khoản thật bị đẩy ra ở lần đăng nhập kế tiếp và không tự vào
 * lại được, vì mã hai bước nằm trên điện thoại của người kia.
 */
export async function beginTwoFactorSetup(userId: string, password: string) {
  const db = getDb();

  const [user] = await db
    .select({
      email: users.email,
      passwordHash: users.passwordHash,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ValidationError("Không tìm thấy tài khoản.", "userId");
  if (user.totpEnabledAt) {
    throw new ValidationError("Xác thực hai bước đã được bật rồi.", "totp");
  }
  if (!password || !(await verifyPassword(password, user.passwordHash))) {
    throw new ValidationError("Mật khẩu không đúng.", "password");
  }

  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: secret, totpLastCounter: null, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(users.id, userId));

  const uri = otpauthUri({ secret, account: user.email, issuer: ISSUER });
  return { secret, otpauthUri: uri, qrMatrix: qrMatrix(uri) };
}

/**
 * Bước 2: xác nhận bằng một mã đúng rồi mới bật.
 *
 * Trả về danh sách mã khôi phục — đây là lần duy nhất chúng hiện ra, vì hệ
 * thống chỉ lưu bản băm.
 */
export async function confirmTwoFactorSetup(userId: string, code: string) {
  const db = getDb();

  const [user] = await db
    .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ValidationError("Không tìm thấy tài khoản.", "userId");
  if (user.totpEnabledAt) {
    throw new ValidationError("Xác thực hai bước đã được bật rồi.", "totp");
  }
  if (!user.totpSecret) {
    throw new ValidationError("Chưa bắt đầu cài đặt. Hãy tạo khóa mới.", "totp");
  }

  const check = await verifyTotp(user.totpSecret, code);
  if (!check.valid) {
    throw new ValidationError(
      "Mã không đúng. Kiểm tra lại giờ trên điện thoại rồi thử mã mới.",
      "code",
    );
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db.insert(recoveryCodes).values(
    await Promise.all(
      codes.map(async (value) => ({
        id: newId("rcv"),
        userId,
        codeHash: await hashCode(value),
      })),
    ),
  );

  await db
    .update(users)
    .set({
      totpEnabledAt: new Date(),
      totpLastCounter: check.counter,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(users.id, userId));

  await writeAudit(db, {
    actorId: userId,
    action: "twoFactor.enable",
    entityType: "user",
    entityId: userId,
  });

  return { recoveryCodes: codes };
}

/** Tắt 2FA. Bắt nhập mã hiện tại để người mượn máy không tắt hộ được. */
export async function disableTwoFactor(userId: string, code: string) {
  const db = getDb();

  const [user] = await db
    .select({
      totpSecret: users.totpSecret,
      totpEnabledAt: users.totpEnabledAt,
      totpLastCounter: users.totpLastCounter,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.totpEnabledAt || !user.totpSecret) {
    throw new ValidationError("Xác thực hai bước chưa được bật.", "totp");
  }

  // Truyền mốc mã đã dùng gần nhất: mã vừa dùng để đăng nhập (người đứng sau
  // lưng nhìn thấy) không dùng lại được để tắt hai bước.
  const accepted = await consumeSecondFactor(
    userId,
    user.totpSecret,
    user.totpLastCounter,
    code,
  );
  if (!accepted) {
    throw new ValidationError("Mã không đúng.", "code");
  }

  await db
    .update(users)
    .set({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastCounter: null,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(users.id, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));

  await writeAudit(db, {
    actorId: userId,
    action: "twoFactor.disable",
    entityType: "user",
    entityId: userId,
  });

  return { ok: true };
}

/**
 * Nhận mã ở bước đăng nhập: chấp nhận mã TOTP hoặc một mã khôi phục.
 *
 * Mã khôi phục chỉ dùng được một lần, dùng xong bị đánh dấu ngay.
 */
export async function consumeSecondFactor(
  userId: string,
  secret: string,
  lastCounter: number | null,
  code: string,
): Promise<boolean> {
  const db = getDb();

  const totp = await verifyTotp(secret, code, lastCounter);
  if (totp.valid && totp.counter !== null) {
    const counter = totp.counter;
    // Ghi mốc bằng một câu UPDATE có điều kiện rồi xem có dòng nào đổi không.
    // Đọc mốc ra, so, rồi ghi đè vô điều kiện thì hai yêu cầu song song cùng
    // mang một mã đều đọc mốc cũ và cùng lọt.
    const claimed = await db
      .update(users)
      .set({ totpLastCounter: counter })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.totpLastCounter), lt(users.totpLastCounter, counter)),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }

  const hash = await hashCode(code);
  const [match] = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hash),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .limit(1);

  if (!match) return false;

  await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(eq(recoveryCodes.id, match.id));

  await writeAudit(db, {
    actorId: userId,
    action: "twoFactor.recoveryCodeUsed",
    entityType: "user",
    entityId: userId,
  });

  return true;
}
