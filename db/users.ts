/**
 * Quản lý tài khoản người dùng.
 *
 * Tài khoản KHÔNG bị xóa cứng: `contracts.created_by`, `payments.recorded_by`
 * và `audit_logs.actor_id` đều trỏ tới đây, xóa đi là mất dấu vết ai đã làm gì.
 * Thay vào đó dùng cờ `is_active` để khóa quyền truy cập.
 */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { hashPassword } from "./auth";
import { getDb } from "./index";
import { newId } from "./ids";
import { ValidationError, writeAudit } from "./internal";
import { sessions, users, type UserRole } from "./schema";
import { MIN_PASSWORD_LENGTH } from "../app/lib/auth-constants";

export type UserView = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  /** Số phiên đăng nhập còn hiệu lực; 0 nghĩa là hiện không đăng nhập ở đâu. */
  activeSessions: number;
};

export async function listUsers(): Promise<UserView[]> {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  const sessionRows = await db
    .select({ userId: sessions.userId, count: sql<number>`count(*)` })
    .from(sessions)
    // Dùng `gt` chứ không viết `sql` thô: cột lưu epoch millisecond nên Date
    // phải được Drizzle chuyển kiểu, D1 không bind Date trực tiếp.
    .where(gt(sessions.expiresAt, now))
    .groupBy(sessions.userId);

  const sessionCount = new Map(sessionRows.map((row) => [row.userId, Number(row.count)]));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    activeSessions: sessionCount.get(row.id) ?? 0,
  }));
}

/**
 * Đếm chủ nhà đang hoạt động, không tính người sắp bị đổi.
 *
 * Dùng để chặn thao tác làm hệ thống không còn chủ nhà nào — khi đó không ai
 * vào được trang quản lý tài khoản để sửa lại.
 */
async function otherActiveOwners(db: ReturnType<typeof getDb>, exceptUserId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true), ne(users.id, exceptUserId)));
  return Number(row?.count ?? 0);
}

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

export type CreateUserInput = {
  email: string;
  fullName: string;
  phone?: string | null;
  password: string;
  role: UserRole;
  /**
   * Ai tạo. `null` cho tài khoản chủ nhà đầu tiên: lúc đó chưa có ai để ghi
   * vào nhật ký, và cột `audit_logs.actor_id` có khóa ngoại sang `users` nên
   * không thể nhét một chuỗi bịa vào.
   */
  actorId: string | null;
};

export async function createUser(input: CreateUserInput) {
  const db = getDb();

  const email = normalizeLogin(input.email);
  const fullName = input.fullName.trim();

  if (!email) throw new ValidationError("Cần nhập email hoặc tên đăng nhập.", "email");
  if (/\s/.test(email)) {
    throw new ValidationError("Email hoặc tên đăng nhập không được có khoảng trắng.", "email");
  }
  if (!fullName) throw new ValidationError("Cần nhập họ tên.", "fullName");
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
      "password",
    );
  }
  if (input.role !== "owner" && input.role !== "staff") {
    throw new ValidationError("Vai trò không hợp lệ.", "role");
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    throw new ValidationError(`"${email}" đã được dùng cho tài khoản khác.`, "email");
  }

  const id = newId("usr");
  await db.insert(users).values({
    id,
    email,
    fullName,
    phone: input.phone?.trim() || null,
    role: input.role,
    passwordHash: await hashPassword(input.password),
  });

  await writeAudit(db, {
    actorId: input.actorId,
    action: "user.create",
    entityType: "user",
    entityId: id,
    changes: { email, fullName, role: input.role },
  });

  return { id, email, fullName, role: input.role };
}

export async function setUserActive(input: {
  userId: string;
  isActive: boolean;
  actorId: string;
}) {
  const db = getDb();

  if (input.userId === input.actorId && !input.isActive) {
    throw new ValidationError("Không thể tự khóa tài khoản của chính mình.", "userId");
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) throw new ValidationError("Không tìm thấy tài khoản.", "userId");

  if (!input.isActive && target.role === "owner") {
    if ((await otherActiveOwners(db, target.id)) === 0) {
      throw new ValidationError(
        "Đây là chủ nhà đang hoạt động duy nhất. Cấp quyền chủ nhà cho người khác trước khi khóa tài khoản này.",
        "userId",
      );
    }
  }

  await db
    .update(users)
    .set({ isActive: input.isActive, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(users.id, target.id));

  // Khóa tài khoản mà không hủy phiên thì người đó vẫn dùng tiếp được cho tới
  // khi phiên hết hạn, tức là việc khóa không có tác dụng ngay.
  if (!input.isActive) {
    await db.delete(sessions).where(eq(sessions.userId, target.id));
  }

  await writeAudit(db, {
    actorId: input.actorId,
    action: input.isActive ? "user.activate" : "user.deactivate",
    entityType: "user",
    entityId: target.id,
    changes: { fullName: target.fullName, isActive: input.isActive },
  });

  return { ok: true };
}

export async function setUserRole(input: {
  userId: string;
  role: UserRole;
  actorId: string;
}) {
  const db = getDb();

  if (input.role !== "owner" && input.role !== "staff") {
    throw new ValidationError("Vai trò không hợp lệ.", "role");
  }
  if (input.userId === input.actorId && input.role !== "owner") {
    throw new ValidationError("Không thể tự bỏ quyền chủ nhà của chính mình.", "role");
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) throw new ValidationError("Không tìm thấy tài khoản.", "userId");

  if (target.role === "owner" && input.role !== "owner") {
    if ((await otherActiveOwners(db, target.id)) === 0) {
      throw new ValidationError(
        "Đây là chủ nhà đang hoạt động duy nhất. Hệ thống phải luôn còn ít nhất một chủ nhà.",
        "role",
      );
    }
  }

  await db
    .update(users)
    .set({ role: input.role, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(users.id, target.id));

  await writeAudit(db, {
    actorId: input.actorId,
    action: "user.role",
    entityType: "user",
    entityId: target.id,
    changes: { fullName: target.fullName, from: target.role, to: input.role },
  });

  return { ok: true };
}

/**
 * Chủ nhà đặt lại mật khẩu cho người khác.
 *
 * Khác với tự đổi mật khẩu: ở đây không hỏi mật khẩu cũ, vì chủ nhà không biết.
 * Bù lại, mọi phiên của tài khoản đó bị hủy để người đang dùng phải đăng nhập
 * lại bằng mật khẩu mới.
 */
export async function resetUserPassword(input: {
  userId: string;
  newPassword: string;
  actorId: string;
}) {
  const db = getDb();

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
      "newPassword",
    );
  }

  const [target] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) throw new ValidationError("Không tìm thấy tài khoản.", "userId");

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(users.id, target.id));

  await db.delete(sessions).where(eq(sessions.userId, target.id));

  await writeAudit(db, {
    actorId: input.actorId,
    action: "user.resetPassword",
    entityType: "user",
    entityId: target.id,
    changes: { fullName: target.fullName },
  });

  return { ok: true };
}
