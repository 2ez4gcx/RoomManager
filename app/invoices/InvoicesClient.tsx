"use client";

import {
  Ban, CheckCircle2, ChevronDown, CircleDollarSign, Download, FilePlus2,
  MoreHorizontal, WalletCards, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, formatMillions, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { InvoiceSummary, InvoiceView } from "../../db/queries-extra";

const ALL = "Tất cả trạng thái";

function tone(label: string) {
  if (label === "Đã thanh toán") return "green";
  if (label === "Quá hạn") return "red";
  if (label === "Thanh toán một phần") return "gold";
  if (label === "Đã hủy") return "gray";
  return "blue";
}

function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `Tháng ${month}/${year}`;
}

export function InvoicesClient({
  invoices,
  summary,
  currentUser,
}: {
  invoices: InvoiceView[];
  summary: InvoiceSummary;
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<InvoiceView | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoices.filter(
      (invoice) =>
        (filter === ALL || invoice.statusLabel === filter) &&
        `${invoice.code} ${invoice.roomCode} ${invoice.tenantName}`
          .toLowerCase()
          .includes(needle),
    );
  }, [filter, invoices, query]);

  function changePeriod(period: string) {
    router.push(`/invoices?period=${period}`);
  }

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm mã đơn, phòng, khách thuê..."
    >
      <div className="content">
        <PageHeader
          eyebrow="TÀI CHÍNH"
          title="Đơn thu & doanh thu"
          description="Theo dõi khoản phải thu, đã thu và công nợ theo từng kỳ."
        >
          <div className="heading-actions">
            <a className="secondary-button" href={`/lap-don-thu?period=${summary.period}`}>
              <FilePlus2 size={15} /> Lập đơn kỳ này
            </a>
            <a
              className="secondary-button"
              href={`/api/export/invoices?period=${summary.period}`}
              download
            >
              <Download size={15} /> Xuất Excel
            </a>
          </div>
        </PageHeader>

        <section className="summary-cards four">
          <article>
            <span className="summary-icon green"><CircleDollarSign size={20} /></span>
            <div>
              <small>Phải thu {periodLabel(summary.period).toLowerCase()}</small>
              <strong>{formatMillions(summary.billed)}</strong>
              <p>{summary.invoiceCount} đơn đã phát hành</p>
            </div>
          </article>
          <article>
            <span className="summary-icon blue"><CheckCircle2 size={20} /></span>
            <div>
              <small>Đã thu</small>
              <strong>{formatMillions(summary.collected)}</strong>
              <p>{summary.billed ? Math.round((summary.collected / summary.billed) * 100) : 0}% kế hoạch</p>
            </div>
          </article>
          <article>
            <span className="summary-icon gold"><WalletCards size={20} /></span>
            <div>
              <small>Còn phải thu kỳ này</small>
              <strong>{formatMillions(summary.outstanding)}</strong>
              <p>{filtered.filter((invoice) => invoice.outstanding > 0).length} đơn chưa đủ</p>
            </div>
          </article>
          <article>
            <span className="summary-icon red"><FilePlus2 size={20} /></span>
            <div>
              <small>Quá hạn (mọi kỳ)</small>
              <strong>{formatMillions(summary.overdueAmount)}</strong>
              <p>{summary.overdueCount} đơn cần nhắc</p>
            </div>
          </article>
        </section>

        <div className="filter-bar">
          <label>
            <select value={summary.period} onChange={(event) => changePeriod(event.target.value)}>
              {(summary.periods.includes(summary.period)
                ? summary.periods
                : [summary.period, ...summary.periods]
              ).map((period) => (
                <option key={period} value={period}>{periodLabel(period)}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option>{ALL}</option>
              <option>Đã thanh toán</option>
              <option>Chờ thanh toán</option>
              <option>Thanh toán một phần</option>
              <option>Quá hạn</option>
              <option>Đã hủy</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <span className="result-count">{filtered.length} đơn thu</span>
        </div>

        <section className="panel data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã đơn</th><th>Phòng & khách thuê</th><th>Kỳ thu</th>
                <th className="money">Tổng đơn</th><th className="money">Đã thu</th>
                <th className="money">Còn nợ</th><th>Trạng thái</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => (
                <tr key={invoice.id} onClick={() => setSelected(invoice)}>
                  <td><strong>{invoice.code}</strong><small className="cell-sub">Hạn {formatDate(invoice.dueDate)}</small></td>
                  <td><strong>{invoice.roomCode}</strong><small className="cell-sub">{invoice.tenantName}</small></td>
                  <td>{periodLabel(invoice.period)}</td>
                  <td className="money"><strong>{money.format(invoice.total)}đ</strong></td>
                  <td className="money">{money.format(invoice.paidAmount)}đ</td>
                  <td className={`money ${invoice.outstanding > 0 ? "debt" : "paid"}`}>
                    {money.format(invoice.outstanding)}đ
                  </td>
                  <td><StatusBadge tone={tone(invoice.statusLabel)}>{invoice.statusLabel}</StatusBadge></td>
                  <td><button className="icon-button" aria-label="Thao tác khác"><MoreHorizontal size={17} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">Không có đơn thu nào trong kỳ này.</div>}
        </section>
      </div>

      <InvoiceModal
        invoice={selected}
        onClose={() => setSelected(null)}
        onPaid={() => {
          setSelected(null);
          router.refresh();
        }}
      />
    </AppShell>
  );
}

function InvoiceModal({
  invoice, onClose, onPaid,
}: {
  invoice: InvoiceView | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;

    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: form.get("amount"),
          method: form.get("method"),
          paidAt: form.get("paidAt"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không ghi nhận được thanh toán.");
        return;
      }
      setPaying(false);
      onPaid();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;

    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/invoices/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, reason: form.get("reason") }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không hủy được đơn thu.");
        return;
      }
      setCancelling(false);
      onPaid();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!invoice}
      onClose={() => {
        setPaying(false);
        setCancelling(false);
        setError("");
        onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">ĐƠN THU {invoice?.code}</span>
          <h2>{invoice?.roomCode} · {invoice ? periodLabel(invoice.period) : ""}</h2>
          <p>{invoice?.tenantName} · {invoice?.propertyName}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>

      {invoice && (
        <>
          <div className="invoice-lines">
            {invoice.items.map((item) => (
              <div key={item.id}>
                <span>
                  {item.description}
                  {item.unit && item.quantity !== 1 && (
                    <small className="cell-sub"> {item.quantity} {item.unit} × {money.format(item.unitPrice)}đ</small>
                  )}
                </span>
                <strong>{money.format(item.amount)}đ</strong>
              </div>
            ))}
            <div className="invoice-total"><span>Tổng cộng</span><strong>{money.format(invoice.total)}đ</strong></div>
            <div><span>Đã thanh toán</span><strong className="paid">− {money.format(invoice.paidAmount)}đ</strong></div>
            <div className="invoice-balance">
              <span>Còn phải thu</span>
              <strong>{money.format(invoice.outstanding)}đ</strong>
            </div>
          </div>

          {cancelling ? (
            <form onSubmit={cancel}>
              <div className="form-section-title">Hủy đơn thu</div>
              <p className="modal-hint">
                Đơn không bị xóa mà chuyển sang trạng thái đã hủy, vẫn tra được về sau.
                Sau khi hủy, kỳ này lập lại đơn được — dùng khi nhập nhầm chỉ số điện.
              </p>
              <label>
                Lý do hủy
                <input name="reason" required placeholder="Nhập nhầm chỉ số điện, lập trùng..." />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setCancelling(false)}>
                  Quay lại
                </button>
                <button className="submit-button danger" type="submit" disabled={busy}>
                  <Ban size={16} /> {busy ? "Đang hủy..." : "Xác nhận hủy đơn"}
                </button>
              </div>
            </form>
          ) : paying ? (
            <form onSubmit={submit}>
              <div className="form-section-title">Ghi nhận thanh toán</div>
              <label>
                Số tiền
                <div className="money-input">
                  <input name="amount" type="number" min={1} max={invoice.outstanding} defaultValue={invoice.outstanding} required />
                  <span>VNĐ</span>
                </div>
              </label>
              <div className="form-grid">
                <label>
                  Hình thức
                  <select name="method" defaultValue="transfer">
                    <option value="transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="card">Thẻ</option>
                    <option value="other">Khác</option>
                  </select>
                </label>
                <label>
                  Ngày thu
                  <input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="submit-button" type="submit" disabled={busy}>
                {busy ? "Đang lưu..." : "Lưu thanh toán"}
              </button>
            </form>
          ) : (
            <>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="modal-actions">
                {invoice.status === "cancelled" ? (
                  <p className="modal-hint">Đơn này đã hủy, không còn tính vào doanh thu hay công nợ.</p>
                ) : (
                  <>
                    {invoice.paidAmount === 0 && (
                      <button className="secondary-button" type="button" onClick={() => setCancelling(true)}>
                        <Ban size={15} /> Hủy đơn
                      </button>
                    )}
                    {invoice.outstanding > 0 ? (
                      <button className="primary-button" onClick={() => setPaying(true)}>
                        Ghi nhận thanh toán
                      </button>
                    ) : (
                      <p className="modal-hint">Đơn này đã thu đủ.</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
