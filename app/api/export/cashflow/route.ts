import { requireApiUser, toErrorResponse } from "../../../lib/api";
import { PERIOD, todayInVietnam } from "../../../../db/internal";
import { listLedgerEntriesForPeriod } from "../../../../db/queries";
import { cashflowSummary } from "../../../../db/queries-extra";
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

    const [summary, inPeriod] = await Promise.all([
      cashflowSummary(period),
      listLedgerEntriesForPeriod(period),
    ]);

    const bytes = createXlsx([
      {
        name: `Thu chi ${period}`,
        columns: [
          { header: "Mã", width: 12 },
          { header: "Ngày", width: 12 },
          { header: "Loại", width: 10 },
          { header: "Nhóm", width: 20 },
          { header: "Nội dung", width: 40 },
          { header: "Nhà", width: 18 },
          { header: "Thu", width: 14, money: true },
          { header: "Chi", width: 14, money: true },
        ],
        rows: [
          ...inPeriod.map((entry) => [
            entry.code,
            entry.occurredAt,
            entry.direction === "in" ? "Thu" : "Chi",
            entry.category,
            entry.description,
            entry.propertyName,
            entry.direction === "in" ? entry.amount : null,
            entry.direction === "out" ? entry.amount : null,
          ]),
          // Dòng tổng ở cuối, đúng chỗ người xem tìm.
          [],
          ["", "", "", "TỔNG", "", "", summary.income, summary.expense],
          ["", "", "", "DÒNG TIỀN THUẦN", "", "", summary.net, null],
        ],
      },
      {
        name: "Cơ cấu chi",
        columns: [
          { header: "Nhóm chi", width: 26 },
          { header: "Số tiền", width: 16, money: true },
          { header: "Tỷ trọng", width: 12 },
        ],
        rows: summary.expenseByCategory.map((row) => [
          row.category,
          row.amount,
          `${row.share}%`,
        ]),
      },
    ]);

    return xlsxResponse(bytes, exportFileName(`thu-chi-${period}`));
  } catch (error) {
    return toErrorResponse(error);
  }
}
