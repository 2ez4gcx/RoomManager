"use client";

import {
  BellRing, Check, Copy, MessageSquare, Phone, RefreshCw, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { ReminderView } from "../../db/reminders";

const KIND_TONE = {
  before_due: "blue",
  due: "gold",
  overdue: "red",
} as const;

const CHANNELS = [
  { value: "zalo", label: "Đã nhắn Zalo" },
  { value: "sms", label: "Đã nhắn SMS" },
  { value: "goi_dien", label: "Đã gọi điện" },
  { value: "bo_qua", label: "Bỏ qua" },
];

export function RemindersClient({
  pending,
  history,
  currentUser,
  pendingCount,
}: {
  pending: ReminderView[];
  history: ReminderView[];
  currentUser: SessionUser;
  pendingCount: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pending.filter((item) =>
      `${item.tenantName} ${item.roomCode} ${item.propertyName} ${item.invoiceCode}`
        .toLowerCase()
        .includes(needle),
    );
  }, [pending, query]);

  const summary = useMemo(
    () => ({
      overdue: pending.filter((item) => item.kind === "overdue").length,
      due: pending.filter((item) => item.kind === "due").length,
      soon: pending.filter((item) => item.kind === "before_due").length,
      total: pending.reduce((sum, item) => sum + item.amount, 0),
    }),
    [pending],
  );

  async function copyMessage(reminder: ReminderView) {
    try {
      await navigator.clipboard.writeText(reminder.message);
      setCopied(reminder.id);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Trình duyệt không cho sao chép tự động. Bôi đen nội dung rồi copy thủ công.");
    }
  }

  async function mark(reminder: ReminderView, channel: string) {
    setError("");
    setBusy(reminder.id);
    try {
      const response = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: reminder.id, channel }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không đánh dấu được.");
        return;
      }
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy("");
    }
  }

  async function rescan() {
    setError("");
    setBusy("scan");
    try {
      const response = await fetch("/api/reminders", { method: "POST" });
      if (!response.ok) {
        setError("Không rà lại được.");
        return;
      }
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm khách thuê, phòng..."
      pendingReminderCount={pendingCount}
    >
      <div className="content">
        <PageHeader
          eyebrow="CÔNG NỢ"
          title="Nhắc nợ"
          description="Hệ thống tự rà mỗi sáng và soạn sẵn tin nhắn cho từng khách."
        >
          <button className="secondary-button" type="button" disabled={busy === "scan"} onClick={rescan}>
            <RefreshCw size={15} /> {busy === "scan" ? "Đang rà..." : "Rà lại ngay"}
          </button>
        </PageHeader>

        <section className="summary-cards four">
          <article>
            <span className="summary-icon red"><BellRing size={20} /></span>
            <div><small>Quá hạn</small><strong>{summary.overdue}</strong><p>Cần nhắc gấp</p></div>
          </article>
          <article>
            <span className="summary-icon gold"><BellRing size={20} /></span>
            <div><small>Đến hạn hôm nay</small><strong>{summary.due}</strong><p>Nhắc trong ngày</p></div>
          </article>
          <article>
            <span className="summary-icon blue"><BellRing size={20} /></span>
            <div><small>Sắp đến hạn</small><strong>{summary.soon}</strong><p>Nhắc trước cho nhẹ nhàng</p></div>
          </article>
          <article>
            <span className="summary-icon green"><MessageSquare size={20} /></span>
            <div>
              <small>Tổng tiền cần thu</small>
              <strong>{money.format(summary.total)}đ</strong>
              <p>{pending.length} lời nhắc chưa xử lý</p>
            </div>
          </article>
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="reminder-list">
          {visible.map((reminder) => (
            <article className="reminder-card" key={reminder.id}>
              <div className="reminder-head">
                <div>
                  <StatusBadge tone={KIND_TONE[reminder.kind]}>{reminder.kindLabel}</StatusBadge>
                  <strong>{reminder.tenantName}</strong>
                  <span>
                    {reminder.roomCode} · {reminder.propertyName} · kỳ {reminder.period}
                  </span>
                </div>
                <div className="reminder-amount">
                  <strong>{money.format(reminder.amount)}đ</strong>
                  <span>hạn {formatDate(reminder.dueDate)}</span>
                </div>
              </div>

              <pre className="reminder-message">{reminder.message}</pre>

              <div className="reminder-actions">
                <a className="secondary-button" href={`tel:${reminder.tenantPhone}`}>
                  <Phone size={14} /> {reminder.tenantPhone}
                </a>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => copyMessage(reminder)}
                >
                  <Copy size={14} /> {copied === reminder.id ? "Đã sao chép" : "Sao chép tin"}
                </button>
                <span className="reminder-spacer" />
                {CHANNELS.map((channel) => (
                  <button
                    key={channel.value}
                    className={channel.value === "bo_qua" ? "secondary-button" : "primary-button"}
                    type="button"
                    disabled={busy === reminder.id}
                    onClick={() => mark(reminder, channel.value)}
                  >
                    {channel.value === "bo_qua" ? <X size={14} /> : <Check size={14} />}
                    {channel.label}
                  </button>
                ))}
              </div>
            </article>
          ))}

          {visible.length === 0 && (
            <div className="panel empty-state">
              {pending.length === 0
                ? "Không có ai cần nhắc. Hệ thống sẽ tự rà lại vào sáng mai."
                : "Không tìm thấy lời nhắc phù hợp."}
            </div>
          )}
        </section>

        {history.length > 0 && (
          <section className="panel data-table-wrap">
            <div className="panel-heading">
              <div><h2>Đã nhắc gần đây</h2><p>Lưu lại để sau còn đối chiếu</p></div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th><th>Khách thuê</th><th>Phòng</th>
                  <th>Mốc</th><th className="money">Số tiền</th><th>Kênh</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.scheduledFor)}</td>
                    <td>{item.tenantName}</td>
                    <td>{item.roomCode}</td>
                    <td>{item.kindLabel}</td>
                    <td className="money">{money.format(item.amount)}đ</td>
                    <td>{CHANNELS.find((c) => c.value === item.channel)?.label ?? item.channel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="modal-hint">
          Hệ thống chưa tự gửi tin cho khách: Zalo OA phải duyệt hồ sơ, còn SMS và email
          đều cần tài khoản dịch vụ trả phí. Hiện tin được soạn sẵn để bạn chuyển qua Zalo
          hoặc gọi điện, xong bấm đánh dấu để lần sau không nhắc trùng.
        </p>
      </div>
    </AppShell>
  );
}
