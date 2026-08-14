"use client";

import { ArrowDownLeft, ArrowUpRight, ChevronDown, Download, Plus, TrendingUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { formatMillions, formatShortDate, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { LedgerView, PropertyOption } from "../../db/queries";
import type { CashflowSummary } from "../../db/queries-extra";

const CATEGORIES = {
  in: ["Tiền phòng", "Tiền cọc", "Phí dịch vụ", "Khác"],
  out: ["Bảo trì", "Điện nước chung", "Nhân sự", "Vật tư", "Vệ sinh", "Khác"],
};

function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `Tháng ${month}/${year}`;
}

/** Sáu kỳ gần nhất tính từ tháng hiện tại, để chọn trong bộ lọc. */
function recentPeriods(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function CashflowClient({
  period, summary, entries, properties, currentUser,
}: {
  period: string;
  summary: CashflowSummary;
  entries: LedgerView[];
  properties: PropertyOption[];
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) =>
      `${entry.description} ${entry.category} ${entry.code}`.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  // Trục biểu đồ bám theo tháng cao nhất, làm tròn lên bội số 20 triệu.
  const peak = Math.max(
    ...summary.monthly.flatMap((month) => [month.income, month.expense]),
    1,
  );
  const axisTop = Math.ceil(peak / 20_000_000) * 20_000_000 || 20_000_000;
  const periods = [...new Set([period, ...recentPeriods()])].sort().reverse();

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm giao dịch..."
      actionLabel="Thêm giao dịch"
      onAction={() => setAdding(true)}
    >
      <div className="content">
        <PageHeader
          eyebrow="DÒNG TIỀN"
          title="Thu chi"
          description="Tổng hợp tiền vào, tiền ra và lợi nhuận vận hành."
        >
          <div className="heading-actions">
            <label className="select-wrap">
              <select value={period} onChange={(event) => router.push(`/cashflow?period=${event.target.value}`)}>
                {periods.map((item) => (
                  <option key={item} value={item}>{periodLabel(item)}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <a className="secondary-button" href={`/api/export/cashflow?period=${period}`} download>
              <Download size={15} /> Xuất báo cáo
            </a>
          </div>
        </PageHeader>

        <section className="summary-cards three">
          <article>
            <span className="summary-icon green"><ArrowDownLeft size={20} /></span>
            <div><small>Tổng thu</small><strong>{formatMillions(summary.income)}</strong><p>{periodLabel(period)}</p></div>
          </article>
          <article>
            <span className="summary-icon red"><ArrowUpRight size={20} /></span>
            <div>
              <small>Tổng chi</small>
              <strong>{formatMillions(summary.expense)}</strong>
              <p>{summary.income ? Math.round((summary.expense / summary.income) * 100) : 0}% tổng thu</p>
            </div>
          </article>
          <article className="featured-summary">
            <span className="summary-icon"><TrendingUp size={20} /></span>
            <div><small>Dòng tiền thuần</small><strong>{formatMillions(summary.net)}</strong><p>Biên vận hành {summary.margin}%</p></div>
          </article>
        </section>

        <section className="cashflow-grid">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div><h2>Thu chi 6 tháng gần nhất</h2><p>Đơn vị: triệu đồng</p></div>
              <div className="chart-legend"><span><i className="income" /> Thu</span><span><i className="expense" /> Chi</span></div>
            </div>
            <div className="bar-chart">
              <div className="chart-axis">
                {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                  <span key={ratio}>{Math.round((axisTop * ratio) / 1_000_000)}</span>
                ))}
              </div>
              {summary.monthly.map((month) => (
                <div className="bar-group" key={month.period}>
                  <div className="bars">
                    <i className="income-bar" style={{ height: `${(month.income / axisTop) * 100}%` }} title={`Thu ${money.format(month.income)}đ`} />
                    <i className="expense-bar" style={{ height: `${(month.expense / axisTop) * 100}%` }} title={`Chi ${money.format(month.expense)}đ`} />
                  </div>
                  <span>{month.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel expense-panel">
            <div className="panel-heading"><div><h2>Cơ cấu chi</h2><p>{periodLabel(period)}</p></div></div>
            <div className="donut-wrap">
              <div className="donut"><span><strong>{formatMillions(summary.expense).replace(" tr", "")}</strong><small>triệu</small></span></div>
              <div className="expense-legend">
                {summary.expenseByCategory.slice(0, 4).map((row, index) => (
                  <span key={row.category}><i className={`e${index + 1}`} /> {row.category} <b>{row.share}%</b></span>
                ))}
                {summary.expenseByCategory.length === 0 && <span>Chưa có khoản chi nào trong kỳ.</span>}
              </div>
            </div>
          </article>
        </section>

        <section className="panel transaction-panel">
          <div className="panel-heading"><div><h2>Giao dịch gần đây</h2><p>Cập nhật theo thời gian ghi nhận</p></div></div>
          <div className="transaction-list">
            {visible.map((entry) => (
              <div className="transaction-row" key={entry.id}>
                <span className={`transaction-icon ${entry.direction === "in" ? "income" : "expense"}`}>
                  {entry.direction === "in" ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                </span>
                <div>
                  <strong>{entry.description || entry.category}</strong>
                  <small>{entry.code} · {formatShortDate(entry.occurredAt)}{entry.propertyName ? ` · ${entry.propertyName}` : ""}</small>
                </div>
                <StatusBadge tone={entry.direction === "in" ? "green" : "red"}>{entry.category}</StatusBadge>
                <b className={entry.direction === "in" ? "paid" : "debt"}>
                  {entry.direction === "in" ? "+" : "−"}{money.format(entry.amount)}đ
                </b>
              </div>
            ))}
            {visible.length === 0 && <div className="empty-state">Chưa có giao dịch nào.</div>}
          </div>
        </section>
      </div>

      <AddEntryModal
        open={adding}
        properties={properties}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          router.refresh();
        }}
      />
    </AppShell>
  );
}

function AddEntryModal({
  open, properties, onClose, onCreated,
}: {
  open: boolean;
  properties: PropertyOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          direction,
          category: form.get("category"),
          description: form.get("description"),
          amount: form.get("amount"),
          occurredAt: form.get("occurredAt"),
          propertyId: form.get("propertyId") || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không lưu được giao dịch.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">SỔ THU CHI</span>
          <h2>Thêm giao dịch</h2>
          <p>Ghi nhận một khoản thu hoặc chi thủ công.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="type-toggle">
          <label>
            <input type="radio" name="type" checked={direction === "in"} onChange={() => setDirection("in")} />
            <span><ArrowDownLeft size={17} /> Khoản thu</span>
          </label>
          <label>
            <input type="radio" name="type" checked={direction === "out"} onChange={() => setDirection("out")} />
            <span><ArrowUpRight size={17} /> Khoản chi</span>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Nhóm giao dịch
            <select name="category">
              {CATEGORIES[direction].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Nhà
            <select name="propertyId" defaultValue="">
              <option value="">Không gắn nhà cụ thể</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Số tiền
          <div className="money-input"><input name="amount" type="number" min={1} required placeholder="0" /><span>VNĐ</span></div>
        </label>
        <div className="form-grid">
          <label>Nội dung<input name="description" placeholder="Mô tả giao dịch" /></label>
          <label>Ngày<input name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={busy}>
          <Plus size={16} /> {busy ? "Đang lưu..." : "Lưu giao dịch"}
        </button>
      </form>
    </Modal>
  );
}
