"use client";

import { ChevronDown, Download, FileText, MoreHorizontal, Phone, Plus, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, initials, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { RoomView, TenantView } from "../../db/queries";

const ALL_STATUSES = "Tất cả trạng thái";

const tones: Record<TenantView["status"], "green" | "gold" | "red" | "gray"> = {
  "Đang thuê": "green",
  "Sắp hết hạn": "gold",
  "Chậm thanh toán": "red",
  "Đã trả phòng": "gray",
};

export function TenantsClient({
  tenants,
  vacantRooms,
  currentUser,
}: {
  tenants: TenantView[];
  vacantRooms: RoomView[];
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL_STATUSES);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tenants.filter(
      (tenant) =>
        (filter === ALL_STATUSES || tenant.status === filter) &&
        `${tenant.fullName} ${tenant.phone} ${tenant.roomCode ?? ""} ${tenant.code}`
          .toLowerCase()
          .includes(needle),
    );
  }, [filter, query, tenants]);

  const summary = useMemo(() => {
    const active = tenants.filter((tenant) => tenant.contractId);
    const debtors = tenants.filter((tenant) => tenant.debt > 0);
    return {
      active: active.length,
      expiring: tenants.filter((tenant) => tenant.status === "Sắp hết hạn").length,
      debtors: debtors.length,
      totalDebt: debtors.reduce((sum, tenant) => sum + tenant.debt, 0),
    };
  }, [tenants]);

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm tên, số điện thoại, phòng..."
      actionLabel="Thêm khách thuê"
      onAction={() => setAdding(true)}
    >
      <div className="content">
        <PageHeader
          eyebrow="KHÁCH THUÊ"
          title="Danh sách khách thuê"
          description="Hồ sơ, hợp đồng và công nợ của người đang thuê phòng."
        >
          <button className="secondary-button" type="button"><Download size={15} /> Xuất danh sách</button>
        </PageHeader>

        <section className="summary-cards three">
          <article>
            <span className="summary-icon green"><Users size={20} /></span>
            <div><small>Đang lưu trú</small><strong>{summary.active} người</strong><p>{summary.active} hợp đồng hiệu lực</p></div>
          </article>
          <article>
            <span className="summary-icon gold"><FileText size={20} /></span>
            <div><small>Sắp hết hạn</small><strong>{summary.expiring} hợp đồng</strong><p>Trong 30 ngày tới</p></div>
          </article>
          <article>
            <span className="summary-icon red"><UserPlus size={20} /></span>
            <div>
              <small>Có công nợ</small>
              <strong>{summary.debtors} khách</strong>
              <p>Tổng {money.format(summary.totalDebt)}đ</p>
            </div>
          </article>
        </section>

        <div className="filter-bar">
          <label>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option>{ALL_STATUSES}</option>
              <option>Đang thuê</option>
              <option>Sắp hết hạn</option>
              <option>Chậm thanh toán</option>
              <option>Đã trả phòng</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <span className="result-count">{filtered.length} khách thuê</span>
        </div>

        <section className="panel data-table-wrap">
          <table className="data-table tenant-table">
            <thead>
              <tr>
                <th>Khách thuê</th><th>Liên hệ</th><th>Phòng</th>
                <th>Thời hạn hợp đồng</th><th>Công nợ</th><th>Trạng thái</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((tenant) => (
                <tr key={tenant.guestId}>
                  <td>
                    <div className="person-cell">
                      <span className="table-avatar">{initials(tenant.fullName)}</span>
                      <div><strong>{tenant.fullName}</strong><small>{tenant.code}</small></div>
                    </div>
                  </td>
                  <td><span className="phone-cell"><Phone size={13} />{tenant.phone}</span></td>
                  <td>
                    <strong>{tenant.roomCode ?? "—"}</strong>
                    <small className="cell-sub">{tenant.propertyName ?? ""}</small>
                  </td>
                  <td>{tenant.startDate ? `${formatDate(tenant.startDate)} — ${formatDate(tenant.endDate)}` : "—"}</td>
                  <td className={tenant.debt ? "debt" : "paid"}>
                    {tenant.debt ? `${money.format(tenant.debt)}đ` : "Không nợ"}
                  </td>
                  <td><StatusBadge tone={tones[tenant.status]}>{tenant.status}</StatusBadge></td>
                  <td><button className="icon-button" aria-label="Thao tác khác"><MoreHorizontal size={17} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">Không tìm thấy khách thuê phù hợp.</div>}
        </section>
      </div>

      <AddTenantModal
        open={adding}
        vacantRooms={vacantRooms}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          router.refresh();
        }}
      />
    </AppShell>
  );
}

function AddTenantModal({
  open, vacantRooms, onClose, onCreated,
}: {
  open: boolean;
  vacantRooms: RoomView[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const activeRoomId = vacantRooms.some((room) => room.id === roomId)
    ? roomId
    : vacantRooms[0]?.id ?? "";
  const activeRoom = vacantRooms.find((room) => room.id === activeRoomId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          phone: form.get("phone"),
          idNumber: form.get("idNumber"),
          dateOfBirth: form.get("dateOfBirth"),
          roomId: activeRoomId,
          startDate: form.get("startDate"),
          deposit: form.get("deposit"),
          rent: activeRoom?.price ?? null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được hồ sơ khách thuê.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">HỒ SƠ MỚI</span>
          <h2>Thêm khách thuê</h2>
          <p>Thông tin cơ bản và hợp đồng thuê phòng.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>

      {vacantRooms.length === 0 ? (
        <div className="empty-state">
          Hiện không còn phòng trống hoặc đang giữ chỗ. Trả phòng hoặc thêm phòng mới trước khi tạo hợp đồng.
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="form-section-title">Thông tin cá nhân</div>
          <div className="form-grid">
            <label>Họ và tên<input name="fullName" required placeholder="Nguyễn Văn A" /></label>
            <label>Số điện thoại<input name="phone" required inputMode="tel" placeholder="09xxxxxxxx" /></label>
          </div>
          <div className="form-grid">
            <label>CCCD<input name="idNumber" placeholder="Số căn cước" /></label>
            <label>Ngày sinh<input name="dateOfBirth" type="date" /></label>
          </div>

          <div className="form-section-title">Thông tin thuê</div>
          <div className="form-grid">
            <label>
              Phòng
              <select value={activeRoomId} onChange={(event) => setRoomId(event.target.value)}>
                {vacantRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.code} · {room.roomTypeName} · {money.format(room.price)}đ
                    {room.status === "Đã giữ" ? " · đang giữ chỗ" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ngày bắt đầu
              <input name="startDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
          </div>
          <label>
            Tiền cọc
            <div className="money-input">
              <input name="deposit" type="number" min={0} defaultValue={activeRoom?.price ?? 0} />
              <span>VNĐ</span>
            </div>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={saving}>
            <Plus size={16} /> {saving ? "Đang lưu..." : "Tạo hồ sơ khách thuê"}
          </button>
        </form>
      )}
    </Modal>
  );
}
