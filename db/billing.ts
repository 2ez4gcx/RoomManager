/**
 * Lập đơn thu theo kỳ.
 *
 * Một kỳ là một tháng dương lịch (`YYYY-MM`). Với mỗi hợp đồng còn hiệu lực,
 * hệ thống dựng một đơn gồm tiền phòng, điện, nước và phí dịch vụ.
 *
 * Không lập đơn hàng loạt mà không cho xem trước: chỉ số điện phải do người
 * chốt sổ nhập tay, và sai một chỉ số là sai tiền của cả tháng. Vì vậy luồng
 * gồm hai bước — xem trước rồi mới phát hành.
 */
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { newId } from "./ids";
import { insertChunked, ValidationError, writeAudit } from "./internal";
import {
  contractGuests,
  contracts,
  guests,
  invoiceItems,
  invoices,
  meterReadings,
  properties,
  rooms,
} from "./schema";
import { getSettings } from "./settings";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Số tiền chia theo ngày được làm tròn tới nghìn đồng cho dễ thu. */
const ROUND_TO = 1000;

export type BillingRow = {
  contractId: string;
  roomId: string;
  roomCode: string;
  roomNumber: string;
  propertyCode: string;
  propertyName: string;
  tenantName: string;
  /** Tiền phòng của kỳ này, đã chia theo ngày nếu hợp đồng bắt đầu giữa kỳ. */
  rent: number;
  /** Ghi chú kèm dòng tiền phòng, ví dụ số ngày ở thực tế. */
  rentNote: string;
  /** Chỉ số điện cuối kỳ trước; điểm bắt đầu tính điện kỳ này. */
  previousReading: number;
  /** Số người ở suy từ hợp đồng, dùng làm gợi ý mặc định. */
  occupants: number;
  dueDate: string;
  /** Mã đơn nếu kỳ này đã lập rồi. */
  existingInvoiceCode: string | null;
};

export type BillingPreview = {
  period: string;
  issueDate: string;
  rates: {
    electricity: number;
    water: number;
    service: number;
  };
  rows: BillingRow[];
  /** Số hợp đồng đã có đơn của kỳ này. */
  alreadyIssued: number;
};

function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, daysInMonth: end.getUTCDate() };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Tiền phòng của kỳ.
 *
 * Hợp đồng bắt đầu giữa kỳ thì chỉ tính từ ngày vào ở: thu trọn tháng của
 * người dọn vào ngày 28 là thu sai.
 */
function rentForPeriod(input: {
  rent: number;
  startDate: string;
  period: string;
}): { amount: number; note: string } {
  const { start, daysInMonth } = periodBounds(input.period);
  const contractStart = new Date(`${input.startDate}T00:00:00Z`);

  if (contractStart <= start) return { amount: input.rent, note: "" };

  const daysCharged = daysInMonth - contractStart.getUTCDate() + 1;
  const exact = (input.rent * daysCharged) / daysInMonth;

  return {
    amount: Math.round(exact / ROUND_TO) * ROUND_TO,
    note: `${daysCharged}/${daysInMonth} ngày, từ ${input.startDate.slice(8)}/${input.startDate.slice(5, 7)}`,
  };
}

/** Hạn thanh toán: ngày thu của hợp đồng, trong chính tháng của kỳ. */
function dueDateFor(period: string, billingDay: number) {
  const { daysInMonth } = periodBounds(period);
  return `${period}-${String(Math.min(billingDay, daysInMonth)).padStart(2, "0")}`;
}

export async function billingPreview(period: string): Promise<BillingPreview> {
  if (!PERIOD_PATTERN.test(period)) {
    throw new ValidationError("Kỳ thu phải có dạng YYYY-MM.", "period");
  }

  const db = getDb();
  const { start, end } = periodBounds(period);
  const settings = await getSettings();

  const rows = await db
    .select({
      contractId: contracts.id,
      rent: contracts.rent,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      billingDay: contracts.billingDay,
      roomId: rooms.id,
      roomCode: rooms.code,
      roomNumber: rooms.number,
      propertyCode: properties.code,
      propertyName: properties.name,
      propertySort: properties.sortOrder,
      tenantName: guests.fullName,
    })
    .from(contracts)
    .innerJoin(rooms, eq(rooms.id, contracts.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .innerJoin(guests, eq(guests.id, contracts.primaryGuestId))
    .where(
      and(
        eq(contracts.status, "active"),
        // Hợp đồng bắt đầu sau kỳ thì chưa phát sinh tiền.
        lte(contracts.startDate, isoDate(end)),
        // Hợp đồng kết thúc trước kỳ thì thôi. `endDate` trống nghĩa là chưa hẹn ngày kết thúc.
        or(isNull(contracts.endDate), sql`${contracts.endDate} >= ${isoDate(start)}`),
      ),
    )
    .orderBy(properties.sortOrder, rooms.number);

  if (rows.length === 0) {
    return {
      period,
      issueDate: isoDate(start),
      rates: {
        electricity: Number(settings["rate.electricity"]),
        water: Number(settings["rate.water"]),
        service: Number(settings["rate.service"]),
      },
      rows: [],
      alreadyIssued: 0,
    };
  }

  const contractIds = rows.map((row) => row.contractId);
  const roomIds = rows.map((row) => row.roomId);

  const [existing, lastReadings, occupantCounts] = await Promise.all([
    db
      .select({ contractId: invoices.contractId, code: invoices.code })
      .from(invoices)
      .where(and(eq(invoices.period, period), inArray(invoices.contractId, contractIds))),
    // Chỉ số gần nhất của mỗi phòng, kể cả của kỳ cũ hơn kỳ liền trước.
    db
      .select({
        roomId: meterReadings.roomId,
        period: meterReadings.period,
        currentValue: meterReadings.currentValue,
      })
      .from(meterReadings)
      .where(
        and(eq(meterReadings.kind, "electricity"), inArray(meterReadings.roomId, roomIds)),
      )
      .orderBy(meterReadings.roomId, desc(meterReadings.period)),
    db
      .select({ contractId: contractGuests.contractId, count: sql<number>`count(*)` })
      .from(contractGuests)
      .where(inArray(contractGuests.contractId, contractIds))
      .groupBy(contractGuests.contractId),
  ]);

  const existingByContract = new Map(existing.map((row) => [row.contractId, row.code]));
  const occupantsByContract = new Map(
    occupantCounts.map((row) => [row.contractId, Number(row.count)]),
  );

  // Đã sắp theo phòng rồi kỳ giảm dần, nên bản ghi đầu tiên của mỗi phòng là mới nhất.
  const latestReading = new Map<string, number>();
  for (const reading of lastReadings) {
    if (reading.period >= period) continue;
    if (!latestReading.has(reading.roomId)) {
      latestReading.set(reading.roomId, reading.currentValue);
    }
  }

  return {
    period,
    issueDate: isoDate(start),
    rates: {
      electricity: Number(settings["rate.electricity"]),
      water: Number(settings["rate.water"]),
      service: Number(settings["rate.service"]),
    },
    alreadyIssued: existing.length,
    rows: rows.map((row) => {
      const rent = rentForPeriod({
        rent: row.rent,
        startDate: row.startDate,
        period,
      });

      return {
        contractId: row.contractId,
        roomId: row.roomId,
        roomCode: row.roomCode,
        roomNumber: row.roomNumber,
        propertyCode: row.propertyCode,
        propertyName: row.propertyName,
        tenantName: row.tenantName,
        rent: rent.amount,
        rentNote: rent.note,
        previousReading: latestReading.get(row.roomId) ?? 0,
        occupants: occupantsByContract.get(row.contractId) ?? 1,
        dueDate: dueDateFor(period, row.billingDay),
        existingInvoiceCode: existingByContract.get(row.contractId) ?? null,
      };
    }),
  };
}

export type IssueInput = {
  period: string;
  actorId: string;
  entries: Array<{
    contractId: string;
    /** Chỉ số điện cuối kỳ. Bỏ trống thì coi như không dùng điện. */
    currentReading?: number | null;
    occupants?: number | null;
    /** Ghi đè tiền phòng khi có thỏa thuận riêng. */
    rent?: number | null;
  }>;
};

export type IssueResult = {
  created: number;
  skipped: number;
  total: number;
};

/**
 * Phát hành đơn cho kỳ.
 *
 * Hợp đồng đã có đơn của kỳ này thì bỏ qua chứ không báo lỗi: bấm lại lần hai
 * là chuyện thường khi mạng chập chờn, và cột `(contract_id, period)` có ràng
 * buộc UNIQUE nên cũng không thể tạo trùng.
 */
export async function issueInvoices(input: IssueInput): Promise<IssueResult> {
  if (!PERIOD_PATTERN.test(input.period)) {
    throw new ValidationError("Kỳ thu phải có dạng YYYY-MM.", "period");
  }

  const db = getDb();
  const preview = await billingPreview(input.period);
  const byContract = new Map(preview.rows.map((row) => [row.contractId, row]));

  const invoiceRows: Array<typeof invoices.$inferInsert> = [];
  const itemRows: Array<typeof invoiceItems.$inferInsert> = [];
  const readingRows: Array<typeof meterReadings.$inferInsert> = [];
  let skipped = 0;

  for (const entry of input.entries) {
    const row = byContract.get(entry.contractId);
    if (!row) {
      throw new ValidationError(
        "Hợp đồng không nằm trong kỳ thu này hoặc đã kết thúc.",
        "contractId",
      );
    }
    if (row.existingInvoiceCode) {
      skipped += 1;
      continue;
    }

    const rent = entry.rent ?? row.rent;
    if (!Number.isInteger(rent) || rent < 0) {
      throw new ValidationError(`Tiền phòng của ${row.roomCode} không hợp lệ.`, "rent");
    }

    const occupants = entry.occupants ?? row.occupants;
    if (!Number.isInteger(occupants) || occupants < 0) {
      throw new ValidationError(`Số người ở của ${row.roomCode} không hợp lệ.`, "occupants");
    }

    const currentReading = entry.currentReading ?? row.previousReading;
    if (!Number.isInteger(currentReading) || currentReading < row.previousReading) {
      throw new ValidationError(
        `Chỉ số điện mới của ${row.roomCode} không được nhỏ hơn chỉ số cũ (${row.previousReading}).`,
        "currentReading",
      );
    }

    const invoiceId = newId("inv");
    const kwh = currentReading - row.previousReading;
    const electricity = kwh * preview.rates.electricity;
    const water = occupants * preview.rates.water;
    const service = preview.rates.service;
    const total = rent + electricity + water + service;

    let readingId: string | null = null;
    if (kwh > 0 || currentReading > 0) {
      readingId = newId("mtr");
      readingRows.push({
        id: readingId,
        roomId: row.roomId,
        kind: "electricity",
        period: input.period,
        previousValue: row.previousReading,
        currentValue: currentReading,
        // Lưu đơn giá tại thời điểm chốt: bảng giá đổi sau không làm đổi đơn cũ.
        unitPrice: preview.rates.electricity,
        readAt: preview.issueDate,
        recordedBy: input.actorId,
      });
    }

    invoiceRows.push({
      id: invoiceId,
      code: `DT-${input.period.replace("-", "")}-${row.roomNumber}-${row.propertyCode}`,
      contractId: row.contractId,
      roomId: row.roomId,
      period: input.period,
      issueDate: preview.issueDate,
      dueDate: row.dueDate,
      total,
      paidAmount: 0,
      status: "issued",
      createdBy: input.actorId,
    });

    itemRows.push(
      {
        id: newId("ivi"),
        invoiceId,
        kind: "rent",
        description: row.rentNote
          ? `Tiền phòng ${input.period} (${row.rentNote})`
          : `Tiền phòng ${input.period}`,
        quantityCenti: 100,
        unit: "tháng",
        unitPrice: rent,
        amount: rent,
        sortOrder: 0,
      },
      {
        id: newId("ivi"),
        invoiceId,
        kind: "electricity",
        description: `Điện ${row.previousReading} → ${currentReading}`,
        quantityCenti: kwh * 100,
        unit: "kWh",
        unitPrice: preview.rates.electricity,
        amount: electricity,
        meterReadingId: readingId,
        sortOrder: 1,
      },
      {
        id: newId("ivi"),
        invoiceId,
        kind: "water",
        description: `Nước ${occupants} người`,
        quantityCenti: occupants * 100,
        unit: "người",
        unitPrice: preview.rates.water,
        amount: water,
        sortOrder: 2,
      },
      {
        id: newId("ivi"),
        invoiceId,
        kind: "service",
        description: "Phí dịch vụ chung",
        quantityCenti: 100,
        unit: "phòng",
        unitPrice: service,
        amount: service,
        sortOrder: 3,
      },
    );
  }

  // Ghi chỉ số trước: dòng điện của đơn trỏ tới bản ghi chỉ số.
  await insertChunked(meterReadings, readingRows, (chunk) => db.insert(meterReadings).values(chunk));
  await insertChunked(invoices, invoiceRows, (chunk) => db.insert(invoices).values(chunk));
  await insertChunked(invoiceItems, itemRows, (chunk) => db.insert(invoiceItems).values(chunk));

  if (invoiceRows.length > 0) {
    await writeAudit(db, {
      actorId: input.actorId,
      action: "invoice.issueBatch",
      entityType: "invoice_period",
      entityId: input.period,
      changes: { created: invoiceRows.length, skipped },
    });
  }

  return {
    created: invoiceRows.length,
    skipped,
    total: input.entries.length,
  };
}
