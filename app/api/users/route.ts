/**
 * Quản lý tài khoản. Toàn bộ chỉ chủ nhà được dùng.
 *
 * Dùng PATCH kèm `id` trong thân yêu cầu thay vì route động `/api/users/[id]`,
 * cho nhất quán với các route khác trong dự án.
 */
import { requireOwner, toErrorResponse } from "../../lib/api";
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from "../../../db/users";
import type { UserRole } from "../../../db/schema";

export async function GET() {
  try {
    await requireOwner();
    return Response.json({ users: await listUsers() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireOwner();
    const body = (await request.json()) as Record<string, unknown>;

    const user = await createUser({
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      phone: body.phone ? String(body.phone) : null,
      password: String(body.password ?? ""),
      role: (body.role === "owner" ? "owner" : "staff") as UserRole,
      actorId: actor.id,
    });

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireOwner();
    const body = (await request.json()) as Record<string, unknown>;
    const userId = String(body.id ?? "");

    if (typeof body.isActive === "boolean") {
      return Response.json(
        await setUserActive({ userId, isActive: body.isActive, actorId: actor.id }),
      );
    }

    if (body.role) {
      return Response.json(
        await setUserRole({
          userId,
          role: (body.role === "owner" ? "owner" : "staff") as UserRole,
          actorId: actor.id,
        }),
      );
    }

    if (body.newPassword) {
      return Response.json(
        await resetUserPassword({
          userId,
          newPassword: String(body.newPassword),
          actorId: actor.id,
        }),
      );
    }

    return Response.json({ error: "Không có thay đổi nào được yêu cầu." }, { status: 400 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
