import { requireApiUser, toErrorResponse } from "../../../lib/api";
import { listTenants } from "../../../../db/queries";
import { createXlsx, exportFileName, xlsxResponse } from "../../../../db/xlsx";

export async function GET() {
  try {
    await requireApiUser();
    const tenants = await listTenants();

    const bytes = createXlsx([
      {
        name: "Khách thuê",
        columns: [
          { header: "Mã khách", width: 12 },
          { header: "Họ và tên", width: 24 },
          { header: "Số điện thoại", width: 15 },
          { header: "Phòng", width: 11 },
          { header: "Nhà", width: 18 },
          { header: "Từ ngày", width: 12 },
          { header: "Đến ngày", width: 12 },
          { header: "Tiền thuê", width: 14, money: true },
          { header: "Công nợ", width: 14, money: true },
          { header: "Trạng thái", width: 18 },
        ],
        rows: tenants.map((tenant) => [
          tenant.code,
          tenant.fullName,
          // Để dạng chuỗi, nếu không Excel cắt mất số 0 đứng đầu.
          tenant.phone,
          tenant.roomCode,
          tenant.propertyName,
          tenant.startDate,
          tenant.endDate,
          tenant.rent,
          tenant.debt,
          tenant.status,
        ]),
      },
    ]);

    return xlsxResponse(bytes, exportFileName("khach-thue", { withDate: true }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
