"use client";

import { Check, ChevronDown, CircleDollarSign, FileText, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, formatMillions, money, recentPeriods } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { BillingPreview } from "../../db/billing";
import { MoneyInput } from "../components/MoneyInput";

/** Giá trị người dùng gõ vào từng dòng; để chuỗi rỗng nghĩa là chưa nhập. */
type Draft = { previousReading: string; currentReading: string; occupants: string; rent: string };

function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `Tháng ${month}/${year}`;
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
    return drafts[contractId] ?? { previousReading: "", currentReading: "", occupants: "", rent: "" };
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
        // Phòng chưa có chỉ số nào: mốc đầu do người lập đơn nhập.
        const previous =
          !row.hasPreviousReading && draft.previousReading !== ""
            ? Number(draft.previousReading)
            : row.previousReading;
        const needsOpening =
          !row.hasPreviousReading &&
          !row.existingInvoiceCode &&
          draft.previousReading === "" &&
          draft.currentReading !== "" &&
          Number(draft.currentReading) > 0;
        const reading =
          draft.currentReading === ""
            ? previous
            : Number(draft.currentReading);
        const occupants = draft.occupants === "" ? row.occupants : Number(draft.occupants);
        const rent = draft.rent === "" ? row.rent : Number(draft.rent);

        const kwh = Number.isFinite(reading) && Number.isFinite(previous) ? reading - previous : 0;
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
          invalid:
            needsOpening ||
            !Number.isFinite(previous) ||
            previous < 0 ||
            (Number.isFinite(reading) && reading < previous),
          needsOpening,
          previous,
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
    // Phát hành xong là không sửa được ở đây nữa, và ô chỉ số để trống được
    // tính 0 kWh. Hỏi lại một lần để không ai bấm nhầm khi mới nhập dở.
    const warning =
      totals.missingReading > 0
        ? `Còn ${totals.missingReading} phòng chưa nhập chỉ số điện, sẽ được tính 0 kWh.\n\n`
        : "";
    if (!window.confirm(`${warning}Phát hành ${totals.count} đơn thu cho ${periodLabel(preview.period)}?`)) {
      return;
    }

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
              previousReading:
                !row.hasPreviousReading && draft.previousReading !== ""
                  ? draft.previousReading
                  : null,
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
                <th className="money">Chỉ số cũ</th><th className="money">Chỉ số mới</th><th className="money">kWh</th><th className="money">Tiền điện</th>
                <th className="money">Người</th><th className="money">Tiền nước</th><th className="money">Tiền phòng</th>
                <th className="money">Tổng đơn</th><th>Hạn</th>
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
                    <td className="money">
                      {entry.row.hasPreviousReading || issued ? (
                        entry.row.previousReading
                      ) : (
                        <input
                          type="number"
                          min={0}
                          className={entry.needsOpening ? "input-invalid" : ""}
                          value={draft.previousReading}
                          placeholder="Chỉ số đầu"
                          title="Phòng chưa có chỉ số điện nào. Nhập số trên công tơ lúc khách vào ở."
                          onChange={(event) =>
                            update(entry.row.contractId, { previousReading: event.target.value })
                          }
                        />
                      )}
                    </td>
                    <td className="money">
                      <input
                        type="number"
                        min={Number.isFinite(entry.previous) ? entry.previous : 0}
                        className={entry.invalid ? "input-invalid" : ""}
                        disabled={issued}
                        value={draft.currentReading}
                        placeholder={String(Number.isFinite(entry.previous) ? entry.previous : 0)}
                        onChange={(event) =>
                          update(entry.row.contractId, { currentReading: event.target.value })
                        }
                      />
                    </td>
                    <td className={`money ${entry.invalid ? "debt" : ""}`}>
                      {entry.invalid ? "sai" : entry.kwh}
                    </td>
                    <td className="money">{money.format(entry.electricity)}đ</td>
                    <td className="money">
                      <input
                        type="number"
                        min={0}
                        disabled={issued}
                        className="input-hep"
                        value={draft.occupants}
                        placeholder={String(entry.row.occupants)}
                        onChange={(event) =>
                          update(entry.row.contractId, { occupants: event.target.value })
                        }
                      />
                    </td>
                    <td className="money">{money.format(entry.water)}đ</td>
                    <td className="money">
                      <MoneyInput
                        disabled={issued || currentUser.role !== "owner"}
                        title={
                          currentUser.role !== "owner"
                            ? "Chỉ chủ nhà được ghi đè tiền phòng"
                            : undefined
                        }
                        value={draft.rent}
                        placeholder={money.format(entry.row.rent)}
                        onValueChange={(rent) => update(entry.row.contractId, { rent })}
                      />
                      {entry.row.rentNote && <small className="cell-sub">{entry.row.rentNote}</small>}
                    </td>
                    <td className="money"><strong>{money.format(entry.total)}đ</strong></td>
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
            Ô để trống sẽ lấy giá trị mờ đang hiện. Phòng chưa từng chốt điện có ô
            &quot;Chỉ số đầu&quot;: nhập số trên công tơ lúc khách vào ở. Phát hành xong đơn không sửa được ở
            đây nữa — muốn đổi thì vào trang Đơn thu.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={busy || totals.count === 0 || totals.invalid > 0}
            title={
              totals.invalid > 0
                ? "Có chỉ số điện nhỏ hơn chỉ số cũ, hoặc phòng chưa nhập chỉ số đầu"
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
