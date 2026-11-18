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
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "./index";
import { newId } from "./ids";
import {
  insertChunked,
  ISO_DATE,
  selectInChunks,
  todayInVietnam,
  ValidationError,
  writeAudit,
} from "./internal";
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
  /**
   * Phòng đã từng có chỉ số điện chưa. Chưa có thì `previousReading` là 0 chỉ
   * vì không biết, và người lập đơn phải nhập chỉ số đầu — nếu không, công tơ
   * đang ở 12.345 sẽ ra đơn đầu tiên 12.345 kWh.
   */
  hasPreviousReading: boolean;
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
 * người dọn vào ngày 28 là thu sai. Tương tự, khách trả phòng giữa kỳ
 * (`endDate`) chỉ tính tới ngày trả.
 */
function rentForPeriod(input: {
  rent: number;
  startDate: string;
  period: string;
  endDate?: string;
}): { amount: number; note: string } {
  const { start, end, daysInMonth } = periodBounds(input.period);
  const contractStart = new Date(`${input.startDate}T00:00:00Z`);
  const contractEnd = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null;

  const firstDay = contractStart > start ? contractStart.getUTCDate() : 1;
  const lastDay = contractEnd && contractEnd < end ? contractEnd.getUTCDate() : daysInMonth;

  if (firstDay === 1 && lastDay === daysInMonth) return { amount: input.rent, note: "" };

  const daysCharged = Math.max(lastDay - firstDay + 1, 0);
  const exact = (input.rent * daysCharged) / daysInMonth;
  const month = input.period.slice(5, 7);
  const pad = (day: number) => String(day).padStart(2, "0");

  return {
    amount: Math.round(exact / ROUND_TO) * ROUND_TO,
    note:
      lastDay === daysInMonth
        ? `${daysCharged}/${daysInMonth} ngày, từ ${pad(firstDay)}/${month}`
        : `${daysCharged}/${daysInMonth} ngày, ${pad(firstDay)}/${month} – ${pad(lastDay)}/${month}`,
  };
}

/**
 * Hạn thanh toán.
 *
 * Bình thường là ngày thu của hợp đồng trong chính tháng của kỳ. Nhưng đơn lập
 * SAU ngày đó (chốt điện cuối tháng, khách vào ở giữa tháng) mà vẫn lấy hạn
 * ấy thì vừa phát hành đã "quá hạn", khách bị gắn nhãn chậm thanh toán và lời
 * nhắc ghi "quá hạn 27 ngày" cho một đơn mới lập hôm qua. Khi đó hạn là ngày
 * thu kế tiếp tính từ ngày lập đơn.
 */
function dueDateFor(period: string, billingDay: number, issueDate: string) {
  const { daysInMonth } = periodBounds(period);
  const inPeriod = `${period}-${String(Math.min(billingDay, daysInMonth)).padStart(2, "0")}`;
  if (inPeriod >= issueDate) return inPeriod;

  const [year, month] = issueDate.split("-").map(Number);
  for (let offset = 0; offset < 2; offset += 1) {
    const last = new Date(Date.UTC(year, month - 1 + offset + 1, 0));
    const candidate = isoDate(
      new Date(
        Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(billingDay, last.getUTCDate())),
      ),
    );
    if (candidate >= issueDate) return candidate;
  }
  return issueDate;
}

type Baseline = { value: number; known: boolean };

/**
 * Chỉ số điện đầu kỳ của từng phòng, cho đúng hợp đồng đang ở phòng đó.
 *
 * Bản ghi chỉ số của CHÍNH kỳ đang lập có thể đã tồn tại, vì ba lý do khác
 * nhau và mỗi lý do cho một mốc khác:
 *
 * - Đang được một đơn còn hiệu lực trỏ tới: kỳ này đã chốt xong (ví dụ khách
 *   trước đã có đơn rồi trả phòng). Mốc là `currentValue`.
 * - Không đơn nào trỏ tới, và chính hợp đồng này có đơn đã hủy trong kỳ: bản
 *   ghi do lần lập trước để lại. Mốc là `previousValue` — lấy `currentValue`
 *   thì lần lập lại ra 0 kWh.
 * - Không đơn nào trỏ tới, hợp đồng này chưa từng lập kỳ này: chỉ số do khách
 *   trước chốt lúc trả phòng. Mốc là `currentValue` — lấy `previousValue` thì
 *   khách mới trả luôn tiền điện của khách cũ.
 */
async function readingBaselines(
  db: ReturnType<typeof getDb>,
  period: string,
  occupants: Array<{ roomId: string; contractId: string }>,
): Promise<Map<string, Baseline>> {
  const contractByRoom = new Map(occupants.map((row) => [row.roomId, row.contractId]));
  const roomIds = [...contractByRoom.keys()];

  const [readings, liveRefs, cancelled] = await Promise.all([
    // Chỉ số gần nhất của mỗi phòng, kể cả của kỳ cũ hơn kỳ liền trước.
    selectInChunks(roomIds, (chunk) =>
      db
        .select({
          id: meterReadings.id,
          roomId: meterReadings.roomId,
          period: meterReadings.period,
          previousValue: meterReadings.previousValue,
          currentValue: meterReadings.currentValue,
        })
        .from(meterReadings)
        .where(and(eq(meterReadings.kind, "electricity"), inArray(meterReadings.roomId, chunk)))
        .orderBy(meterReadings.roomId, desc(meterReadings.period)),
    ),
    db
      .select({ readingId: invoiceItems.meterReadingId })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoices.period, period),
          ne(invoices.status, "cancelled"),
          isNotNull(invoiceItems.meterReadingId),
        ),
      ),
    db
      .select({ contractId: invoices.contractId })
      .from(invoices)
      .where(and(eq(invoices.period, period), eq(invoices.status, "cancelled"))),
  ]);

  const referenced = new Set(liveRefs.map((row) => row.readingId));
  const hasCancelled = new Set(cancelled.map((row) => row.contractId));

  // Đã sắp theo phòng rồi kỳ giảm dần, nên bản ghi đầu tiên gặp là mới nhất.
  const baselines = new Map<string, Baseline>();
  for (const reading of readings) {
    if (reading.period > period || baselines.has(reading.roomId)) continue;

    const leftByOwnCancelledInvoice =
      reading.period === period &&
      !referenced.has(reading.id) &&
      hasCancelled.has(contractByRoom.get(reading.roomId) ?? "");

    baselines.set(reading.roomId, {
      value: leftByOwnCancelledInvoice ? reading.previousValue : reading.currentValue,
      known: true,
    });
  }
  return baselines;
}

export async function billingPreview(
  period: string,
  today = todayInVietnam(),
): Promise<BillingPreview> {
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
      issueDate: today,
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
  const inThisPeriod = new Set(contractIds);

  const [existingAll, baselines, occupantCounts] = await Promise.all([
    // Lọc theo kỳ rồi đối chiếu trong bộ nhớ, không truyền danh sách id vào SQL.
    db
      .select({ contractId: invoices.contractId, code: invoices.code })
      .from(invoices)
      // Bỏ qua đơn đã hủy: hủy xong phải lập lại được cho đúng kỳ đó.
      .where(and(eq(invoices.period, period), ne(invoices.status, "cancelled"))),
    readingBaselines(db, period, rows),
    selectInChunks(contractIds, (chunk) =>
      db
        .select({ contractId: contractGuests.contractId, count: sql<number>`count(*)` })
        .from(contractGuests)
        .where(inArray(contractGuests.contractId, chunk))
        .groupBy(contractGuests.contractId),
    ),
  ]);

  const existing = existingAll.filter((row) => inThisPeriod.has(row.contractId));
  const existingByContract = new Map(existing.map((row) => [row.contractId, row.code]));
  const occupantsByContract = new Map(
    occupantCounts.map((row) => [row.contractId, Number(row.count)]),
  );

  return {
    period,
    // Ngày lập là ngày thật sự phát hành, không phải ngày đầu kỳ.
    issueDate: today,
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
      const baseline = baselines.get(row.roomId);

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
        previousReading: baseline?.value ?? 0,
        hasPreviousReading: baseline?.known ?? false,
        occupants: occupantsByContract.get(row.contractId) ?? 1,
        dueDate: dueDateFor(period, row.billingDay, today),
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
    /**
     * Chỉ số điện đầu kỳ, CHỈ được dùng khi phòng chưa từng có chỉ số nào.
     * Phòng đã có lịch sử thì mốc lấy từ lịch sử, giá trị gửi lên bị bỏ qua.
     */
    previousReading?: number | null;
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

  // Mã đơn phải duy nhất toàn hệ thống, kể cả so với đơn đã hủy: khi báo khách
  // "đơn DT-..." thì mã đó chỉ được trỏ tới đúng một đơn.
  const usedCodes = new Set(
    (
      await db
        .select({ code: invoices.code })
        .from(invoices)
        .where(eq(invoices.period, input.period))
    ).map((row) => row.code),
  );

  /** `DT-202609-101-AP`, rồi `-L2`, `-L3`... nếu kỳ đó từng lập rồi hủy. */
  function nextInvoiceCode(row: BillingRow) {
    const base = `DT-${input.period.replace("-", "")}-${row.roomNumber}-${row.propertyCode}`;
    let code = base;
    for (let attempt = 2; usedCodes.has(code); attempt += 1) {
      code = `${base}-L${attempt}`;
    }
    usedCodes.add(code);
    return code;
  }

  // Chỉ số của chính kỳ này có thể đã tồn tại (đơn cũ bị hủy rồi lập lại).
  // Phải dùng lại đúng id đang có: `onConflictDoUpdate` giữ nguyên id của bản
  // ghi cũ, sinh id mới rồi trỏ dòng đơn vào đó sẽ vỡ khóa ngoại.
  const readingIdByRoom = new Map(
    (
      await db
        .select({ id: meterReadings.id, roomId: meterReadings.roomId })
        .from(meterReadings)
        .where(and(eq(meterReadings.period, input.period), eq(meterReadings.kind, "electricity")))
    ).map((row) => [row.roomId, row.id] as const),
  );

  const invoiceRows: Array<typeof invoices.$inferInsert> = [];
  const itemRows: Array<typeof invoiceItems.$inferInsert> = [];
  const readingRows: Array<typeof meterReadings.$inferInsert> = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (const entry of input.entries) {
    // Một hợp đồng gửi lên hai lần thì dòng thứ hai sẽ vấp ràng buộc UNIQUE
    // sau khi chỉ số điện đã bị ghi đè.
    if (seen.has(entry.contractId)) continue;
    seen.add(entry.contractId);

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

    // Phòng chưa có chỉ số nào: lấy chỉ số đầu do người lập đơn nhập.
    const previousReading =
      !row.hasPreviousReading && entry.previousReading != null
        ? entry.previousReading
        : row.previousReading;
    if (!Number.isInteger(previousReading) || previousReading < 0) {
      throw new ValidationError(
        `Chỉ số điện đầu của ${row.roomCode} không hợp lệ.`,
        "previousReading",
      );
    }

    const currentReading = entry.currentReading ?? previousReading;
    if (!Number.isInteger(currentReading) || currentReading < previousReading) {
      throw new ValidationError(
        `Chỉ số điện mới của ${row.roomCode} không được nhỏ hơn chỉ số cũ (${previousReading}).`,
        "currentReading",
      );
    }
    if (!row.hasPreviousReading && entry.previousReading == null && currentReading > 0) {
      throw new ValidationError(
        `Phòng ${row.roomCode} chưa có chỉ số điện nào. Nhập chỉ số đầu (số trên công tơ lúc khách vào ở) để không tính tiền điện từ 0.`,
        "previousReading",
      );
    }

    const invoiceId = newId("inv");
    const kwh = currentReading - previousReading;
    const electricity = kwh * preview.rates.electricity;
    const water = occupants * preview.rates.water;
    const service = preview.rates.service;
    const total = rent + electricity + water + service;

    let readingId: string | null = null;
    if (kwh > 0 || currentReading > 0) {
      readingId = readingIdByRoom.get(row.roomId) ?? newId("mtr");
      readingRows.push({
        id: readingId,
        roomId: row.roomId,
        kind: "electricity",
        period: input.period,
        previousValue: previousReading,
        currentValue: currentReading,
        // Lưu đơn giá tại thời điểm chốt: bảng giá đổi sau không làm đổi đơn cũ.
        unitPrice: preview.rates.electricity,
        readAt: preview.issueDate,
        recordedBy: input.actorId,
      });
    }

    invoiceRows.push({
      id: invoiceId,
      code: nextInvoiceCode(row),
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
        description: `Điện ${previousReading} → ${currentReading}`,
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
  //
  // Ghi đè nếu kỳ này đã có chỉ số — xảy ra khi đơn cũ bị hủy rồi lập lại.
  // Bản ghi cũ được giữ nguyên lúc hủy để không mất mốc chỉ số đầu kỳ.
  await insertChunked(meterReadings, readingRows, (chunk) =>
    db
      .insert(meterReadings)
      .values(chunk)
      .onConflictDoUpdate({
        target: [meterReadings.roomId, meterReadings.kind, meterReadings.period],
        set: {
          previousValue: sql`excluded.previous_value`,
          currentValue: sql`excluded.current_value`,
          unitPrice: sql`excluded.unit_price`,
          readAt: sql`excluded.read_at`,
          updatedAt: sql`(unixepoch() * 1000)`,
        },
      }),
  );
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

export type ClosingResult = {
  /** Đơn chốt vừa lập, nếu có. */
  invoice: { id: string; code: string; total: number } | null;
  /**
   * Tiền điện phát sinh sau đơn đã lập của kỳ, chưa nằm trong đơn nào. Người
   * gọi trừ vào tiền cọc.
   */
  extraElectricity: number;
  extraElectricityNote: string;
};

/**
 * Chốt tiền của tháng cuối khi trả phòng.
 *
 * Lập đơn theo kỳ chỉ lấy hợp đồng còn hiệu lực, nên không có bước này thì
 * khách trả phòng ngày 20 trước khi kỳ đó được lập sẽ không bao giờ bị tính 20
 * ngày tiền phòng và tiền điện của mình. Và không chốt công tơ thì khách sau
 * thừa kế chỉ số cũ, trả luôn phần điện khách trước dùng.
 *
 * - Kỳ của ngày trả CHƯA có đơn và `issueInvoice` bật: lập đơn chốt, tiền
 *   phòng chia tới ngày trả, điện tính tới chỉ số chốt.
 * - Kỳ đó ĐÃ có đơn: không lập đơn thứ hai (mỗi hợp đồng một đơn mỗi kỳ).
 *   Phần điện dùng thêm sau đơn đó trả về cho người gọi để trừ vào cọc.
 * - Có chỉ số chốt thì luôn ghi lại, kể cả khi không thu gì, để khách sau bắt
 *   đầu từ đúng số đó.
 *
 * Gọi SAU khi đã giành hợp đồng, nên hợp đồng lúc này ở trạng thái "ended".
 */
export async function closeOutBilling(input: {
  contractId: string;
  endDate: string;
  finalReading?: number | null;
  issueInvoice: boolean;
  actorId: string;
}): Promise<ClosingResult> {
  if (!ISO_DATE.test(input.endDate)) {
    throw new ValidationError("Ngày trả phòng không hợp lệ.", "endDate");
  }
  const finalReading = input.finalReading ?? null;
  if (finalReading !== null && (!Number.isInteger(finalReading) || finalReading < 0)) {
    throw new ValidationError("Chỉ số điện lúc trả phòng không hợp lệ.", "finalReading");
  }

  const none: ClosingResult = { invoice: null, extraElectricity: 0, extraElectricityNote: "" };
  if (!input.issueInvoice && finalReading === null) return none;

  const db = getDb();
  const period = input.endDate.slice(0, 7);

  const [contract] = await db
    .select({
      id: contracts.id,
      rent: contracts.rent,
      startDate: contracts.startDate,
      roomId: rooms.id,
      roomCode: rooms.code,
      roomNumber: rooms.number,
      propertyCode: properties.code,
    })
    .from(contracts)
    .innerJoin(rooms, eq(rooms.id, contracts.roomId))
    .innerJoin(properties, eq(properties.id, rooms.propertyId))
    .where(eq(contracts.id, input.contractId))
    .limit(1);
  if (!contract) throw new ValidationError("Không tìm thấy hợp đồng.", "contractId");

  const settings = await getSettings();
  const rates = {
    electricity: Number(settings["rate.electricity"]),
    water: Number(settings["rate.water"]),
    service: Number(settings["rate.service"]),
  };

  const [periodInvoices, baselines, [existingReading], [occupantRow]] = await Promise.all([
    db
      .select({ code: invoices.code, contractId: invoices.contractId, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.period, period)),
    readingBaselines(db, period, [{ roomId: contract.roomId, contractId: contract.id }]),
    db
      .select({ id: meterReadings.id, previousValue: meterReadings.previousValue })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.roomId, contract.roomId),
          eq(meterReadings.kind, "electricity"),
          eq(meterReadings.period, period),
        ),
      )
      .limit(1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contractGuests)
      .where(eq(contractGuests.contractId, contract.id)),
  ]);

  const alreadyInvoiced = periodInvoices.some(
    (row) => row.contractId === contract.id && row.status !== "cancelled",
  );
  const baseline = baselines.get(contract.roomId);

  if (finalReading !== null && baseline?.known && finalReading < baseline.value) {
    throw new ValidationError(
      `Chỉ số điện lúc trả phòng không được nhỏ hơn chỉ số đã chốt gần nhất (${baseline.value}).`,
      "finalReading",
    );
  }

  // Không biết mốc đầu thì không tính được số điện đã dùng: tính từ 0 là ra
  // một con số khổng lồ. Chỉ ghi chỉ số chốt làm mốc cho khách sau.
  const previousReading = baseline?.known ? baseline.value : (finalReading ?? 0);
  const kwh = finalReading !== null ? finalReading - previousReading : 0;
  const electricity = kwh * rates.electricity;

  const readingId = existingReading?.id ?? newId("mtr");
  const upsertReading = () =>
    db
      .insert(meterReadings)
      .values({
        id: readingId,
        roomId: contract.roomId,
        kind: "electricity",
        period,
        // Kỳ đã có bản ghi (đơn của kỳ đã lập) thì giữ mốc đầu kỳ của nó.
        previousValue: existingReading ? existingReading.previousValue : previousReading,
        currentValue: finalReading ?? previousReading,
        unitPrice: rates.electricity,
        readAt: input.endDate,
        recordedBy: input.actorId,
      })
      .onConflictDoUpdate({
        target: [meterReadings.roomId, meterReadings.kind, meterReadings.period],
        set: {
          currentValue: sql`excluded.current_value`,
          readAt: sql`excluded.read_at`,
          updatedAt: sql`(unixepoch() * 1000)`,
        },
      });

  if (alreadyInvoiced || !input.issueInvoice) {
    if (finalReading !== null) await upsertReading();
    const charge = alreadyInvoiced && input.issueInvoice && electricity > 0;
    return {
      invoice: null,
      extraElectricity: charge ? electricity : 0,
      extraElectricityNote: charge
        ? `Điện chốt lúc trả phòng ${previousReading} → ${finalReading}: ${kwh} kWh`
        : "",
    };
  }

  const rent = rentForPeriod({
    rent: contract.rent,
    startDate: contract.startDate,
    period,
    endDate: input.endDate,
  });
  const occupants = Math.max(Number(occupantRow?.count ?? 1), 1);
  const water = occupants * rates.water;
  const total = rent.amount + electricity + water + rates.service;

  const usedCodes = new Set(periodInvoices.map((row) => row.code));
  const base = `DT-${period.replace("-", "")}-${contract.roomNumber}-${contract.propertyCode}`;
  let code = base;
  for (let attempt = 2; usedCodes.has(code); attempt += 1) code = `${base}-L${attempt}`;

  const invoiceId = newId("inv");
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db.insert(invoices).values({
      id: invoiceId,
      code,
      contractId: contract.id,
      roomId: contract.roomId,
      period,
      issueDate: input.endDate,
      // Đơn chốt đến hạn ngay ngày trả phòng: nó được cấn vào cọc liền sau đó.
      dueDate: input.endDate,
      total,
      paidAmount: 0,
      status: "issued",
      createdBy: input.actorId,
    }),
  ];
  if (finalReading !== null) statements.unshift(upsertReading());

  statements.push(
    db.insert(invoiceItems).values([
      {
        id: newId("ivi"),
        invoiceId,
        kind: "rent",
        description: rent.note
          ? `Tiền phòng ${period} (${rent.note})`
          : `Tiền phòng ${period}`,
        quantityCenti: 100,
        unit: "tháng",
        unitPrice: rent.amount,
        amount: rent.amount,
        sortOrder: 0,
      },
      {
        id: newId("ivi"),
        invoiceId,
        kind: "electricity",
        description:
          finalReading !== null
            ? `Điện ${previousReading} → ${finalReading} (chốt lúc trả phòng)`
            : "Điện: không chốt chỉ số lúc trả phòng",
        quantityCenti: kwh * 100,
        unit: "kWh",
        unitPrice: rates.electricity,
        amount: electricity,
        meterReadingId: finalReading !== null ? readingId : null,
        sortOrder: 1,
      },
    ]),
    db.insert(invoiceItems).values([
      {
        id: newId("ivi"),
        invoiceId,
        kind: "water",
        description: `Nước ${occupants} người`,
        quantityCenti: occupants * 100,
        unit: "người",
        unitPrice: rates.water,
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
        unitPrice: rates.service,
        amount: rates.service,
        sortOrder: 3,
      },
    ]),
  );

  await db.batch(statements);

  await writeAudit(db, {
    actorId: input.actorId,
    action: "invoice.issueClosing",
    entityType: "invoice",
    entityId: invoiceId,
    changes: { code, total, endDate: input.endDate, finalReading },
  });

  return { invoice: { id: invoiceId, code, total }, extraElectricity: 0, extraElectricityNote: "" };
}
