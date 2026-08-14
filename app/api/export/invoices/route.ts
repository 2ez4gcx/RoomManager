import { requireApiUser, toErrorResponse } from "../../../lib/api";
import { listInvoices } from "../../../../db/queries-extra";
import { createXlsx, exportFileName, xlsxResponse } from "../../../../db/xlsx";

export async function GET(request: Request) {
  try {
    await requireApiUser();

    const period =
      new URL(request.url).searchParams.get("period") ??
      new Date().toISOString().slice(0, 7);
    const invoices = await listInvoices(period);

    /** Tổng tiền theo từng loại dòng, để cột nào ra cột nấy. */
    function amountOf(invoice: (typeof invoices)[number], kind: string) {
      return invoice.items
        .filter((item) => item.kind === kind)
        .reduce((sum, item) => sum + item.amount, 0);
    }

    const bytes = createXlsx([
      {
        name: `Đơn thu ${period}`,
        columns: [
          { header: "Mã đơn", width: 24 },
          { header: "Phòng", width: 11 },
          { header: "Nhà", width: 18 },
          { header: "Khách thuê", width: 24 },
          { header: "Kỳ thu", width: 10 },
          { header: "Hạn thanh toán", width: 14 },
          { header: "Tiền phòng", width: 14, money: true },
          { header: "Tiền điện", width: 13, money: true },
          { header: "Tiền nước", width: 13, money: true },
          { header: "Phí dịch vụ", width: 13, money: true },
          { header: "Tổng đơn", width: 14, money: true },
          { header: "Đã thu", width: 14, money: true },
          { header: "Còn nợ", width: 14, money: true },
          { header: "Trạng thái", width: 20 },
        ],
        rows: invoices.map((invoice) => [
          invoice.code,
          invoice.roomCode,
          invoice.propertyName,
          invoice.tenantName,
          invoice.period,
          invoice.dueDate,
          amountOf(invoice, "rent"),
          amountOf(invoice, "electricity"),
          amountOf(invoice, "water"),
          amountOf(invoice, "service"),
          invoice.total,
          invoice.paidAmount,
          invoice.outstanding,
          invoice.statusLabel,
        ]),
      },
    ]);

    return xlsxResponse(bytes, exportFileName(`don-thu-${period}`));
  } catch (error) {
    return toErrorResponse(error);
  }
}
