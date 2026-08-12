"use client";

import { CalendarCheck, Clock3, ExternalLink, Phone, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader } from "../components/AppShell";
import { formatDate } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { BookingStats, BookingView } from "../../db/queries-extra";

type Status = BookingView["status"];

const COLUMNS: Array<{ value: Status; label: string; tone: string }> = [
  { value: "new", label: "Mới", tone: "blue" },
  { value: "contacted", label: "Đang tư vấn", tone: "gold" },
  { value: "confirmed", label: "Đã xác nhận", tone: "green" },
  { value: "rejected", label: "Không phù hợp", tone: "gray" },
];

const LABELS = Object.fromEntries(COLUMNS.map((column) => [column.value, column.label])) as Record<Status, string>;

function relativeTime(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)} phút trước`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} giờ trước`;
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "Hôm qua" : `${days} ngày trước`;
}

export function BookingsClient({
  bookings,
  stats,
  currentUser,
}: {
  bookings: BookingView[];
  stats: BookingStats;
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BookingView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookings.filter((booking) =>
      `${booking.fullName} ${booking.phone} ${booking.propertyName ?? ""} ${booking.code}`
        .toLowerCase()
        .includes(needle),
    );
  }, [bookings, query]);

  async function move(id: string, status: Status) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không đổi được trạng thái.");
        return;
      }
      setSelected(null);
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm người đặt, số điện thoại..."
      newBookingCount={stats.newCount}
    >
      <div className="content wide-content">
        <PageHeader
          eyebrow="ĐẶT PHÒNG ONLINE"
          title="Yêu cầu đặt phòng"
          description="Theo dõi từ lúc khách gửi yêu cầu đến khi xác nhận giữ phòng."
        >
          <a className="secondary-button" href="/booking" target="_blank" rel="noreferrer">
            Mở trang công khai <ExternalLink size={15} />
          </a>
        </PageHeader>

        <section className="booking-summary">
          <article><CalendarCheck size={20} /><div><strong>{stats.total}</strong><span>Tổng yêu cầu</span></div></article>
          <article><Clock3 size={20} /><div><strong>{stats.newCount}</strong><span>Chưa xử lý</span></div></article>
          <article><Users size={20} /><div><strong>{stats.conversionRate}%</strong><span>Tỷ lệ xác nhận</span></div></article>
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="kanban-board">
          {COLUMNS.map((column) => {
            const items = visible.filter((booking) => booking.status === column.value);
            return (
              <div className="kanban-column" key={column.value}>
                <div className="kanban-heading">
                  <span><i className={`kanban-dot dot-${column.tone}`} />{column.label}</span>
                  <b>{items.length}</b>
                </div>
                <div className="kanban-list">
                  {items.map((booking) => (
                    <button className="booking-card" key={booking.id} onClick={() => setSelected(booking)}>
                      <div>
                        <span className="booking-id">{booking.code}</span>
                        <small>{relativeTime(booking.createdAt)}</small>
                      </div>
                      <h3>{booking.fullName}</h3>
                      <p><Phone size={13} />{booking.phone}</p>
                      <div className="booking-room">
                        <strong>{booking.roomCode ?? booking.roomTypeName ?? "Chưa chọn phòng"}</strong>
                        <span>{booking.propertyName ?? "Chưa rõ nhà"}</span>
                      </div>
                      <div className="booking-meta">
                        <span>Nhận phòng</span>
                        <b>{formatDate(booking.preferredMoveIn)}</b>
                        <span>{booking.occupants} người</span>
                      </div>
                    </button>
                  ))}
                  {items.length === 0 && <div className="empty-state">Chưa có yêu cầu.</div>}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)}>
        <div className="modal-heading">
          <div>
            <span className="modal-kicker">YÊU CẦU {selected?.code}</span>
            <h2>{selected?.fullName}</h2>
            <p>Gửi {selected ? relativeTime(selected.createdAt) : ""}</p>
          </div>
          <button className="icon-button" onClick={() => setSelected(null)} aria-label="Đóng"><X size={20} /></button>
        </div>
        {selected && (
          <>
            <div className="booking-detail-grid">
              <div><span>Số điện thoại</span><strong>{selected.phone}</strong></div>
              <div><span>Số người ở</span><strong>{selected.occupants} người</strong></div>
              <div><span>Nhu cầu</span><strong>{selected.roomCode ?? selected.roomTypeName ?? "—"}</strong></div>
              <div><span>Ngày muốn xem</span><strong>{formatDate(selected.preferredMoveIn)}</strong></div>
            </div>

            <label>
              Trạng thái
              <select
                value={selected.status}
                disabled={busy}
                onChange={(event) => move(selected.id, event.target.value as Status)}
              >
                {COLUMNS.map((column) => (
                  <option key={column.value} value={column.value}>{column.label}</option>
                ))}
              </select>
            </label>

            {selected.holdUntil && (
              <p className="hold-note">
                Đang giữ phòng {selected.roomCode} tới {formatDate(selected.holdUntil.slice(0, 10))}.
              </p>
            )}

            {selected.message && (
              <div className="note-box"><strong>Ghi chú từ khách</strong><p>{selected.message}</p></div>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="modal-actions">
              <a className="secondary-button" href={`tel:${selected.phone}`}><Phone size={15} /> Gọi khách</a>
              {selected.status !== "confirmed" && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => move(selected.id, "confirmed")}
                >
                  {busy ? "Đang lưu..." : "Xác nhận giữ phòng"}
                </button>
              )}
            </div>
            <p className="modal-hint">Trạng thái hiện tại: {LABELS[selected.status]}</p>
          </>
        )}
      </Modal>
    </AppShell>
  );
}
