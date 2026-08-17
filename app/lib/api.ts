import { cookies } from "next/headers";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "../../db/auth";
import { ValidationError } from "../../db/mutations";

export class UnauthorizedError extends Error {
  constructor(message = "Chưa đăng nhập.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Tài khoản không có quyền thực hiện thao tác này.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Xác thực cho route API.
 *
 * `proxy.ts` chỉ nhìn cookie có tồn tại hay không, nên mọi route đụng đến dữ
 * liệu riêng tư đều phải gọi hàm này để kiểm tra phiên với cơ sở dữ liệu.
 */
export async function requireApiUser(): Promise<SessionUser> {
  const store = await cookies();
  const user = await resolveSession(store.get(SESSION_COOKIE)?.value);
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Thao tác chỉ chủ nhà được làm, ví dụ thêm nhà mới. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireApiUser();
  if (user.role !== "owner") throw new ForbiddenError();
  return user;
}

/** Chuyển lỗi thành phản hồi JSON với mã trạng thái đúng. */
export function toErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message, field: error.field }, { status: 400 });
  }
  // Lỗi ngoài dự kiến: ghi ra log cho người vận hành, trả cho client một câu
  // chung. Thông báo gốc hay chứa tên bảng, tên cột hoặc mảnh câu SQL — không
  // giúp gì người dùng mà lại vẽ bản đồ hệ thống cho người dò.
  console.error("[loi-khong-mong-doi]", error);
  return Response.json(
    { error: "Có lỗi xảy ra. Thử lại, nếu vẫn lỗi thì báo người quản trị." },
    { status: 500 },
  );
}

/** Đọc số nguyên từ dữ liệu biểu mẫu, trả null khi bỏ trống. */
export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
}
