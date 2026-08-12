import { requireApiUser, requireOwner, toErrorResponse } from "../../lib/api";
import { getSettings, updateSettings, type SettingKey } from "../../../db/settings";

export async function GET() {
  try {
    await requireApiUser();
    return Response.json({ settings: await getSettings() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    // Bảng giá ảnh hưởng tới mọi đơn thu lập sau đó, chỉ chủ nhà được đổi.
    const user = await requireOwner();

    const body = (await request.json()) as Record<string, unknown>;
    const values = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, String(value ?? "")]),
    ) as Partial<Record<SettingKey, string>>;

    return Response.json(await updateSettings(values, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
