import { requireApiUser, toErrorResponse } from "../../../lib/api";
import { PERIOD, todayInVietnam } from "../../../../db/internal";
import { listInvoices } from "../../../../db/queries-extra";
import { createXlsx, exportFileName, xlsxResponse } from "../../../../db/xlsx";

export async function GET(request: Request) {
  try {
    await requireApiUser();

    const period =
      new URL(request.url).searchParams.get("period") ?? todayInVietnam().slice(0, 7);
    if (!PERIOD.test(period)) {
      return Response.json(
        { error: "Kỳ phải có dạng YYYY-MM.", field: "period" },
        { status: 400 },
      );
    }
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
        rows: [
          ...invoices.map((invoice) => {
            // Đơn đã hủy vẫn liệt kê để truy vết, nhưng không mang số tiền:
            // hủy rồi lập lại mà cả hai dòng đều đủ tiền thì cộng cột "Tổng
            // đơn" ra gấp đôi số phải thu thật.
            const live = invoice.status !== "cancelled";
            return [
              invoice.code,
              invoice.roomCode,
              invoice.propertyName,
              invoice.tenantName,
              invoice.period,
              invoice.dueDate,
              live ? amountOf(invoice, "rent") : 0,
              live ? amountOf(invoice, "electricity") : 0,
              live ? amountOf(invoice, "water") : 0,
              live ? amountOf(invoice, "service") : 0,
              live ? invoice.total : 0,
              live ? invoice.paidAmount : 0,
              live ? invoice.outstanding : 0,
              invoice.statusLabel,
            ];
          }),
          (() => {
            const live = invoices.filter((invoice) => invoice.status !== "cancelled");
            const sum = (pick: (invoice: (typeof invoices)[number]) => number) =>
              live.reduce((total, invoice) => total + pick(invoice), 0);
            return [
              "TỔNG",
              "",
              "",
              `${live.length} đơn`,
              period,
              "",
              sum((invoice) => amountOf(invoice, "rent")),
              sum((invoice) => amountOf(invoice, "electricity")),
              sum((invoice) => amountOf(invoice, "water")),
              sum((invoice) => amountOf(invoice, "service")),
              sum((invoice) => invoice.total),
              sum((invoice) => invoice.paidAmount),
              sum((invoice) => invoice.outstanding),
              "",
            ];
          })(),
        ],
      },
    ]);

    return xlsxResponse(bytes, exportFileName(`don-thu-${period}`));
  } catch (error) {
    return toErrorResponse(error);
  }
}
