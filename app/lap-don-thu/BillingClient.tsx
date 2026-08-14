"use client";

import { Check, ChevronDown, CircleDollarSign, FileText, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, formatMillions, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { BillingPreview } from "../../db/billing";

/** Giá trị người dùng gõ vào từng dòng; để chuỗi rỗng nghĩa là chưa nhập. */
type Draft = { currentReading: string; occupants: string; rent: string };

function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `Tháng ${month}/${year}`;
}

/** Sáu kỳ gần nhất tính từ tháng hiện tại. */
function recentPeriods(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function BillingClient({
  preview,
  currentUser,
}: {
  preview: BillingPreview;
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const pending = preview.rows.filter((row) => !row.existingInvoiceCode);

  function draftFor(contractId: string): Draft {
    return drafts[contractId] ?? { currentReading: "", occupants: "", rent: "" };
  }

  function update(contractId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [contractId]: { ...draftFor(contractId), ...patch },
    }));
  }

  /** Tính lại từng dòng theo số đang gõ, để người chốt sổ thấy tiền ngay. */
  const computed = useMemo(
    () =>
      preview.rows.map((row) => {
        const draft = draftFor(row.contractId);
        const reading =
          draft.currentReading === ""
            ? row.previousReading
            : Number(draft.currentReading);
        const occupants = draft.occupants === "" ? row.occupants : Number(draft.occupants);
        const rent = draft.rent === "" ? row.rent : Number(draft.rent);

        const kwh = Number.isFinite(reading) ? reading - row.previousReading : 0;
        const electricity = kwh > 0 ? kwh * preview.rates.electricity : 0;
        const water = (Number.isFinite(occupants) ? occupants : 0) * preview.rates.water;
        const rentAmount = Number.isFinite(rent) ? rent : 0;

        return {
          row,
          kwh,
          electricity,
          water,
          service: preview.rates.service,
          total: rentAmount + electricity + water + preview.rates.service,
          // Công tơ không quay ngược; số nhỏ hơn chỉ số cũ chắc chắn là gõ nhầm.
          invalid: Number.isFinite(reading) && reading < row.previousReading,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, drafts],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return computed.filter((entry) =>
      `${entry.row.roomCode} ${entry.row.tenantName} ${entry.row.propertyName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [computed, query]);

  const totals = useMemo(() => {
    const rows = computed.filter((entry) => !entry.row.existingInvoiceCode);
    return {
      count: rows.length,
      amount: rows.reduce((sum, entry) => sum + entry.total, 0),
      missingReading: rows.filter(
        (entry) => draftFor(entry.row.contractId).currentReading === "",
      ).length,
      invalid: rows.filter((entry) => entry.invalid).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed, drafts]);

  async function issue() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          period: preview.period,
          entries: pending.map((row) => {
            const draft = draftFor(row.contractId);
            return {
              contractId: row.contractId,
              currentReading: draft.currentReading === "" ? null : draft.currentReading,
              occupants: draft.occupants === "" ? null : draft.occupants,
              rent: draft.rent === "" ? null : draft.rent,
            };
          }),
        }),
      });
      const payload = (await response.json()) as {
        created?: number;
        skipped?: number;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Không phát hành được đơn thu.");
        return;
      }
      setResult({ created: payload.created ?? 0, skipped: payload.skipped ?? 0 });
      setDrafts({});
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  const periods = [...new Set([preview.period, ...recentPeriods()])].sort().reverse();

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm phòng, khách thuê..."
    >
      <div className="content">
        <PageHeader
          eyebrow="TÀI CHÍNH"
          title="Lập đơn thu"
          description="Nhập chỉ số điện cuối kỳ rồi phát hành đơn cho tất cả phòng đang thuê."
        >
          <label className="select-wrap">
            <select
              value={preview.period}
              onChange={(event) => router.push(`/lap-don-thu?period=${event.target.value}`)}
            >
              {periods.map((period) => (
                <option key={period} value={period}>{periodLabel(period)}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </PageHeader>

        <section className="summary-cards four">
          <article>
            <span className="summary-icon green"><FileText size={20} /></span>
            <div>
              <small>Sẽ phát hành</small>
              <strong>{totals.count} đơn</strong>
              <p>{preview.alreadyIssued} đơn đã lập trước đó</p>
            </div>
          </article>
          <article>
            <span className="summary-icon blue"><CircleDollarSign size={20} /></span>
            <div>
              <small>Tổng tiền dự kiến</small>
              <strong>{formatMillions(totals.amount)}</strong>
              <p>Theo số đang nhập</p>
            </div>
          </article>
          <article>
            <span className="summary-icon gold"><Zap size={20} /></span>
            <div>
              <small>Chưa nhập chỉ số</small>
              <strong>{totals.missingReading} phòng</strong>
              <p>Để trống thì tính 0 kWh</p>
            </div>
          </article>
          <article>
            <span className="summary-icon green"><Zap size={20} /></span>
            <div>
              <small>Đơn giá đang áp</small>
              <strong>{money.format(preview.rates.electricity)}đ</strong>
              <p>mỗi kWh · nước {money.format(preview.rates.water)}đ/người</p>
            </div>
          </article>
        </section>

        {result && (
          <div className="security-callout callout-ok">
            <Check size={22} />
            <div>
              <strong>Đã phát hành {result.created} đơn thu</strong>
              <p>
                {result.skipped > 0 && `Bỏ qua ${result.skipped} phòng đã có đơn. `}
                Xem chi tiết ở trang Đơn thu.
              </p>
            </div>
            <a href={`/invoices?period=${preview.period}`}>Tới trang Đơn thu</a>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="panel data-table-wrap">
          <table className="data-table billing-table">
            <thead>
              <tr>
                <th>Phòng</th><th>Khách thuê</th>
                <th>Chỉ số cũ</th><th>Chỉ số mới</th><th>kWh</th><th>Tiền điện</th>
                <th>Người</th><th>Tiền nước</th><th>Tiền phòng</th>
                <th>Tổng đơn</th><th>Hạn</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const draft = draftFor(entry.row.contractId);
                const issued = !!entry.row.existingInvoiceCode;

                return (
                  <tr key={entry.row.contractId} className={issued ? "row-issued" : ""}>
                    <td>
                      <strong>{entry.row.roomCode}</strong>
                      <small className="cell-sub">{entry.row.propertyName}</small>
                    </td>
                    <td>
                      {entry.row.tenantName}
                      {issued && (
                        <small className="cell-sub">
                          <StatusBadge tone="gray">{entry.row.existingInvoiceCode}</StatusBadge>
                        </small>
                      )}
                    </td>
                    <td>{entry.row.previousReading}</td>
                    <td>
                      <input
                        type="number"
                        min={entry.row.previousReading}
                        className={entry.invalid ? "input-invalid" : ""}
                        disabled={issued}
                        value={draft.currentReading}
                        placeholder={String(entry.row.previousReading)}
                        onChange={(event) =>
                          update(entry.row.contractId, { currentReading: event.target.value })
                        }
                      />
                    </td>
                    <td className={entry.invalid ? "debt" : ""}>
                      {entry.invalid ? "sai" : entry.kwh}
                    </td>
                    <td>{money.format(entry.electricity)}đ</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        disabled={issued}
                        value={draft.occupants}
                        placeholder={String(entry.row.occupants)}
                        onChange={(event) =>
                          update(entry.row.contractId, { occupants: event.target.value })
                        }
                      />
                    </td>
                    <td>{money.format(entry.water)}đ</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        disabled={issued}
                        value={draft.rent}
                        placeholder={String(entry.row.rent)}
                        onChange={(event) =>
                          update(entry.row.contractId, { rent: event.target.value })
                        }
                      />
                      {entry.row.rentNote && <small className="cell-sub">{entry.row.rentNote}</small>}
                    </td>
                    <td><strong>{money.format(entry.total)}đ</strong></td>
                    <td>{formatDate(entry.row.dueDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="empty-state">
              Không có hợp đồng nào cần lập đơn cho kỳ này.
            </div>
          )}
        </section>

        <div className="billing-actions">
          <p className="modal-hint">
            Ô để trống sẽ lấy giá trị mờ đang hiện. Phát hành xong đơn không sửa được ở
            đây nữa — muốn đổi thì vào trang Đơn thu.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={busy || totals.count === 0 || totals.invalid > 0}
            title={
              totals.invalid > 0
                ? "Có chỉ số điện nhỏ hơn chỉ số cũ"
                : totals.count === 0
                  ? "Không còn phòng nào cần lập đơn"
                  : undefined
            }
            onClick={issue}
          >
            <FileText size={16} />
            {busy ? "Đang phát hành..." : `Phát hành ${totals.count} đơn thu`}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
