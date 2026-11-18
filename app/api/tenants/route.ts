import { ForbiddenError, requireApiUser, toErrorResponse, toNumber } from "../../lib/api";
import { createTenant, updateTenant } from "../../../db/mutations";
import { listTenants } from "../../../db/queries";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ tenants: await listTenants() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();

    const body = (await request.json()) as Record<string, unknown>;
    const result = await createTenant({
      actorId: user.id,
      fullName: String(body.fullName ?? ""),
      phone: String(body.phone ?? ""),
      idNumber: body.idNumber ? String(body.idNumber) : null,
      dateOfBirth: body.dateOfBirth ? String(body.dateOfBirth) : null,
      roomId: String(body.roomId ?? ""),
      startDate: String(body.startDate ?? ""),
      months: toNumber(body.months) ?? 12,
      rent: toNumber(body.rent),
      deposit: toNumber(body.deposit),
      billingDay: toNumber(body.billingDay) ?? 5,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Sửa hồ sơ khách và hợp đồng đang hiệu lực.
 *
 * Dùng PATCH kèm `guestId` trong thân yêu cầu, cùng kiểu với `/api/users`.
 * Tên và số điện thoại thì nhân viên sửa được. Giá thuê, ngày thu và thời hạn
 * hợp đồng quyết định số tiền thu hằng tháng, nên chỉ chủ nhà được đổi.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json()) as Record<string, unknown>;

    const rent = toNumber(body.rent);
    const billingDay = toNumber(body.billingDay);
    const endDate = typeof body.endDate === "string" ? body.endDate : null;

    if (user.role !== "owner" && (rent !== null || billingDay !== null || endDate !== null)) {
      throw new ForbiddenError("Chỉ chủ nhà được sửa giá thuê, ngày thu và thời hạn hợp đồng.");
    }

    return Response.json(
      await updateTenant({
        guestId: String(body.guestId ?? ""),
        fullName: typeof body.fullName === "string" ? body.fullName : null,
        phone: typeof body.phone === "string" ? body.phone : null,
        rent,
        billingDay,
        endDate,
        actorId: user.id,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
