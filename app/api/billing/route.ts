import { billingPreview, issueInvoices } from "../../../db/billing";
import { todayInVietnam } from "../../../db/internal";
import { requireApiUser, toErrorResponse, toNumber } from "../../lib/api";

function currentPeriod() {
  return todayInVietnam().slice(0, 7);
}

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const period = new URL(request.url).searchParams.get("period") ?? currentPeriod();
    return Response.json(await billingPreview(period));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Nhân viên cũng chốt sổ được: đây là việc vận hành hằng tháng, không phải
    // thay đổi cấu trúc tài sản hay bảng giá.
    const user = await requireApiUser();
    const body = (await request.json()) as Record<string, unknown>;

    // Thiếu `entries` là lỗi của người gọi, không phải "chốt sổ xong mà không
    // có gì". Trước đây gửi sai tên trường vẫn nhận 201 Created kèm
    // `{created: 0}` — người gọi tưởng xong việc trong khi chưa phát hành đơn
    // nào.
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return Response.json(
        { error: "Cần danh sách phòng để lập đơn (trường `entries`).", field: "entries" },
        { status: 400 },
      );
    }
    const entries = body.entries;

    const result = await issueInvoices({
      period: String(body.period ?? currentPeriod()),
      actorId: user.id,
      entries: entries.map((raw) => {
        const entry = raw as Record<string, unknown>;
        return {
          contractId: String(entry.contractId ?? ""),
          currentReading: toNumber(entry.currentReading),
          previousReading: toNumber(entry.previousReading),
          occupants: toNumber(entry.occupants),
          rent: toNumber(entry.rent),
        };
      }),
    });

    // 201 Created chỉ đúng khi có thứ được tạo. Gửi danh sách rỗng hay sai tên
    // trường mà vẫn nhận "Created" thì người gọi tưởng xong việc, trong khi
    // chưa có đơn nào được phát hành.
    return Response.json(result, { status: result.created > 0 ? 201 : 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
