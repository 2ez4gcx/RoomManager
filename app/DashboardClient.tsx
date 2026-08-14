"use client";

import {
  ArrowRight, BedDouble, BellRing, Building2, CalendarDays, ChevronDown,
  CircleDollarSign, Clock3, FileText,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "./components/AppShell";
import { formatMillions, formatShortDate, money } from "./lib/format";
import type { SessionUser } from "../db/auth";
import type { DashboardSummary, RoomStatus, RoomView } from "../db/queries";

const statusClass: Record<RoomStatus, string> = {
  "Đang thuê": "status-rented",
  Trống: "status-empty",
  "Đã giữ": "status-booked",
  "Bảo trì": "status-maintenance",
};

const ALL_PROPERTIES = "Tất cả nhà";

const WEEKDAYS = ["CHỦ NHẬT", "THỨ HAI", "THỨ BA", "THỨ TƯ", "THỨ NĂM", "THỨ SÁU", "THỨ BẢY"];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

export function DashboardClient({
  summary,
  rooms,
  currentUser,
}: {
  summary: DashboardSummary;
  rooms: RoomView[];
  currentUser: SessionUser;
}) {
  const [building, setBuilding] = useState(ALL_PROPERTIES);
  const [query, setQuery] = useState("");

  const filteredRooms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rooms
      .filter(
        (room) =>
          (building === ALL_PROPERTIES || room.propertyName === building) &&
          `${room.code} ${room.tenantName ?? ""} ${room.roomTypeName}`
            .toLowerCase()
            .includes(needle),
      )
      .slice(0, 8);
  }, [building, query, rooms]);

  const today = new Date();
  const heading = `${WEEKDAYS[today.getDay()]}, ${today.getDate()} THÁNG ${today.getMonth() + 1}`;
  const period = `${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const pendingTasks =
    summary.overdueInvoices +
    summary.newBookings +
    summary.expiringContracts +
    summary.pendingReminders;

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      newBookingCount={summary.newBookings}
      pendingReminderCount={summary.pendingReminders}
    >
      <div className="content">
        <PageHeader
          eyebrow={heading}
          title={`${greeting()}, ${currentUser.fullName}`}
          description={
            pendingTasks > 0
              ? `Có ${pendingTasks} việc cần xem hôm nay.`
              : "Mọi thứ đang vận hành ổn, chưa có việc nào cần xử lý."
          }
        >
          <label className="select-wrap">
            <Building2 size={16} />
            <select aria-label="Chọn nhà" value={building} onChange={(event) => setBuilding(event.target.value)}>
              <option>{ALL_PROPERTIES}</option>
              {summary.byProperty.map((property) => (
                <option key={property.id}>{property.name}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
        </PageHeader>

        <section className="metric-grid" aria-label="Chỉ số vận hành">
          <article className="metric-card metric-featured">
            <div className="metric-icon"><CircleDollarSign size={20} /></div>
            <span>Đã thu tháng {period}</span>
            <strong>{formatMillions(summary.collected)}</strong>
            <div className="metric-detail">
              <b>{summary.billed > 0 ? Math.round((summary.collected / summary.billed) * 100) : 0}%</b>
              <span>trên tổng phải thu {formatMillions(summary.billed)}</span>
            </div>
            <div className="sparkline"><i /><i /><i /><i /><i /><i /><i /></div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <div className="metric-icon pale"><BedDouble size={20} /></div>
              <span className="trend">{summary.vacantRooms} trống</span>
            </div>
            <span>Đang có khách</span>
            <strong>{summary.occupiedRooms} <small>/ {summary.totalRooms} phòng</small></strong>
            <div className="progress"><i style={{ width: `${summary.occupancyRate}%` }} /></div>
            <div className="metric-detail"><span>Công suất lấp đầy</span><b>{summary.occupancyRate}%</b></div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <div className="metric-icon amber"><Clock3 size={20} /></div>
              {summary.outstanding > 0 && <span className="warning">Cần xử lý</span>}
            </div>
            <span>Chưa thanh toán</span>
            <strong>{formatMillions(summary.outstanding)}</strong>
            <div className="metric-detail"><span>{summary.overdueInvoices} đơn đã quá hạn</span></div>
            <a className="text-button" href="/invoices">Xem danh sách <ArrowRight size={14} /></a>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <div className="metric-icon terracotta"><CalendarDays size={20} /></div>
              <span className="trend neutral">Tháng này</span>
            </div>
            <span>Yêu cầu đặt phòng</span>
            <strong>{summary.newBookings} <small>chưa xử lý</small></strong>
            <div className="metric-detail"><span>{summary.heldRooms} phòng đang giữ chỗ</span></div>
            <a className="text-button" href="/bookings">Duyệt yêu cầu <ArrowRight size={14} /></a>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="panel rooms-panel">
            <div className="panel-heading">
              <div><h2>Tình trạng phòng</h2><p>Đọc trực tiếp từ hợp đồng đang hiệu lực</p></div>
              <div className="legend">
                <span><i className="dot rented" /> Đang thuê</span>
                <span><i className="dot empty" /> Trống</span>
                <span><i className="dot booked" /> Đã giữ</span>
              </div>
            </div>
            <div className="room-list">
              {filteredRooms.map((room) => (
                <a className="room-row" href="/rooms" key={room.id}>
                  <div className={`room-door ${statusClass[room.status]}`}><BedDouble size={18} /></div>
                  <div className="room-main">
                    <strong>Phòng {room.number}</strong>
                    <span>{room.roomTypeName} · {room.propertyName}</span>
                  </div>
                  <div className="room-tenant">
                    <strong>{room.tenantName ?? "Sẵn sàng cho thuê"}</strong>
                    <span>{room.status}</span>
                  </div>
                  <div className="room-price">
                    <strong>{money.format(room.price)}đ</strong>
                    <span>{room.dueDate ? `Hạn ${formatShortDate(room.dueDate)}` : "mỗi tháng"}</span>
                  </div>
                  <span className={`status-pill ${statusClass[room.status]}`}>{room.status}</span>
                </a>
              ))}
              {filteredRooms.length === 0 && <div className="empty-state">Không tìm thấy phòng phù hợp.</div>}
            </div>
            <a className="panel-footer" href="/rooms">Xem toàn bộ {summary.totalRooms} phòng <ArrowRight size={15} /></a>
          </article>

          <div className="side-stack">
            <article className="panel activity-panel">
              <div className="panel-heading">
                <div><h2>Việc cần làm</h2><p>Hôm nay</p></div>
                <span className="count-badge">{pendingTasks}</span>
              </div>
              <div className="task-list">
                {summary.overdueInvoices > 0 && (
                  <a href="/invoices">
                    <span className="task-icon overdue"><Clock3 size={16} /></span>
                    <div>
                      <strong>{summary.overdueInvoices} đơn đã quá hạn</strong>
                      <small>Còn phải thu {formatMillions(summary.outstanding)}</small>
                    </div>
                    <ArrowRight size={15} />
                  </a>
                )}
                {summary.newBookings > 0 && (
                  <a href="/bookings">
                    <span className="task-icon booking"><CalendarDays size={16} /></span>
                    <div><strong>{summary.newBookings} yêu cầu đặt mới</strong><small>Chưa được xử lý</small></div>
                    <ArrowRight size={15} />
                  </a>
                )}
                {summary.pendingReminders > 0 && (
                  <a href="/nhac-no">
                    <span className="task-icon overdue"><BellRing size={16} /></span>
                    <div>
                      <strong>{summary.pendingReminders} lời nhắc nợ chờ gửi</strong>
                      <small>Tin đã soạn sẵn, chỉ việc gửi</small>
                    </div>
                    <ArrowRight size={15} />
                  </a>
                )}
                {summary.expiringContracts > 0 && (
                  <a href="/tenants">
                    <span className="task-icon contract"><FileText size={16} /></span>
                    <div>
                      <strong>{summary.expiringContracts} hợp đồng sắp hết hạn</strong>
                      <small>Trong 30 ngày tới</small>
                    </div>
                    <ArrowRight size={15} />
                  </a>
                )}
                {pendingTasks === 0 && <div className="empty-state">Không có việc nào cần xử lý.</div>}
              </div>
            </article>

            <article className="panel occupancy-panel">
              <div className="panel-heading"><div><h2>Công suất theo nhà</h2><p>Tháng {period}</p></div></div>
              {summary.byProperty.map((property, index) => (
                <div className="property-stat" key={property.id}>
                  <div><strong>{property.name}</strong><span>{property.occupied}/{property.total} phòng</span></div>
                  <b>{property.rate}%</b>
                  <div className={`progress ${index % 2 === 1 ? "orange" : ""}`}>
                    <i style={{ width: `${property.rate}%` }} />
                  </div>
                </div>
              ))}
            </article>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
