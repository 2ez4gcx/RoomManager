"use client";

import {
  Check, ChevronDown, Download, FileText, LogOut, Pencil, Phone, Plus, UserPlus, Users, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, initials, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { RoomView, TenantView } from "../../db/queries";
import type { MoveOutPreview, MoveOutResult } from "../../db/move-out";

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
  const [movingOut, setMovingOut] = useState<TenantView | null>(null);
  const [editing, setEditing] = useState<TenantView | null>(null);

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
          <a className="secondary-button" href="/api/export/tenants" download>
            <Download size={15} /> Xuất danh sách
          </a>
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
                <th>Thời hạn hợp đồng</th><th className="money">Công nợ</th><th>Trạng thái</th><th />
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
                  <td className={`money ${tenant.debt ? "debt" : "paid"}`}>
                    {tenant.debt ? `${money.format(tenant.debt)}đ` : "Không nợ"}
                  </td>
                  <td><StatusBadge tone={tones[tenant.status]}>{tenant.status}</StatusBadge></td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setEditing(tenant)}
                      >
                        <Pencil size={14} /> Sửa
                      </button>
                      {tenant.contractId && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setMovingOut(tenant)}
                        >
                          <LogOut size={14} /> Trả phòng
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">Không tìm thấy khách thuê phù hợp.</div>}
        </section>
      </div>

      <MoveOutModal
        tenant={movingOut}
        onClose={() => setMovingOut(null)}
        onDone={() => router.refresh()}
      />
      <EditTenantModal
        key={editing?.guestId ?? "none"}
        tenant={editing}
        isOwner={currentUser.role === "owner"}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
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

/**
 * Sửa hồ sơ khách và hợp đồng đang hiệu lực.
 *
 * Chỉ gửi lên những trường thật sự đổi: máy chủ coi trường vắng mặt là "giữ
 * nguyên", và nhân viên không có quyền đụng tới các trường của hợp đồng.
 */
function EditTenantModal({
  tenant, isOwner, onClose, onSaved,
}: {
  tenant: TenantView | null;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    setError("");
    setSaving(true);

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const body: Record<string, unknown> = { guestId: tenant.guestId };

    if (text("fullName") !== tenant.fullName) body.fullName = text("fullName");
    if (text("phone") !== tenant.phone) body.phone = text("phone");
    if (isOwner && tenant.contractId) {
      if (text("rent") !== String(tenant.rent)) body.rent = text("rent");
      if (text("billingDay") !== String(tenant.billingDay ?? "")) body.billingDay = text("billingDay");
      if (text("endDate") !== (tenant.endDate ?? "")) body.endDate = text("endDate");
    }

    try {
      const response = await fetch("/api/tenants", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không lưu được thay đổi.");
        return;
      }
      onSaved();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!tenant} onClose={onClose} wide>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">SỬA HỒ SƠ</span>
          <h2>{tenant?.fullName}</h2>
          <p>{tenant?.roomCode ? `Phòng ${tenant.roomCode} · ${tenant.propertyName}` : "Đã trả phòng"}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>

      {tenant && (
        <form onSubmit={submit}>
          <div className="form-section-title">Thông tin cá nhân</div>
          <div className="form-grid">
            <label>Họ và tên<input name="fullName" required defaultValue={tenant.fullName} /></label>
            <label>Số điện thoại<input name="phone" required inputMode="tel" defaultValue={tenant.phone} /></label>
          </div>

          {tenant.contractId && (
            <>
              <div className="form-section-title">Hợp đồng đang hiệu lực</div>
              <div className="form-grid">
                <label>
                  Giá thuê mỗi tháng
                  <div className="money-input">
                    <input name="rent" type="number" min={1} required disabled={!isOwner} defaultValue={tenant.rent} />
                    <span>VNĐ</span>
                  </div>
                </label>
                <label>
                  Ngày thu hằng tháng (1–28)
                  <input
                    name="billingDay"
                    type="number"
                    min={1}
                    max={28}
                    required
                    disabled={!isOwner}
                    defaultValue={tenant.billingDay ?? 5}
                  />
                </label>
              </div>
              <label>
                Ngày hết hạn hợp đồng
                <input name="endDate" type="date" disabled={!isOwner} defaultValue={tenant.endDate ?? ""} />
              </label>
              <p className="modal-hint">
                {isOwner
                  ? "Thay đổi áp dụng từ đơn lập sau này; đơn đã lập giữ nguyên số tiền. Để trống ngày hết hạn nếu hợp đồng không thời hạn. Hết hạn không tự kết thúc hợp đồng: khách vẫn được lập đơn cho tới khi trả phòng."
                  : "Chỉ chủ nhà được sửa giá thuê, ngày thu và thời hạn hợp đồng."}
              </p>
            </>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={saving}>
            <Check size={16} /> {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        </form>
      )}
    </Modal>
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

/**
 * Hộp thoại trả phòng.
 *
 * Tải trước tình trạng nợ và tiền cọc rồi tính sẵn phần hoàn lại, để người
 * thao tác thấy con số trước khi chốt — kết thúc hợp đồng là việc không hoàn tác được.
 */
function MoveOutModal({
  tenant, onClose, onDone,
}: {
  tenant: TenantView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<MoveOutPreview | null>(null);
  const [deductions, setDeductions] = useState("");
  const [finalReading, setFinalReading] = useState("");
  const [issueFinal, setIssueFinal] = useState(true);
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<MoveOutResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Nạp khi mở hộp thoại cho một hợp đồng khác.
  if (tenant?.contractId && loadedFor !== tenant.contractId) {
    setLoadedFor(tenant.contractId);
    setPreview(null);
    setResult(null);
    setError("");
    setDeductions("");
    setFinalReading("");
    setIssueFinal(true);
    fetch(`/api/move-out?contractId=${encodeURIComponent(tenant.contractId)}`)
      .then(async (response) => {
        const payload = (await response.json()) as MoveOutPreview & { error?: string };
        if (!response.ok) {
          setError(payload.error ?? "Không tải được thông tin hợp đồng.");
          return;
        }
        setPreview(payload);
      })
      .catch(() => setError("Không kết nối được máy chủ."));
  }

  const deduction = deductions === "" ? 0 : Number(deductions);
  const settled = preview ? Math.min(preview.deposit, preview.outstanding) : 0;
  const afterDebt = preview ? preview.deposit - settled : 0;
  const kept = Math.min(Number.isFinite(deduction) ? deduction : 0, afterDebt);
  const refund = afterDebt - kept;
  const stillOwed = preview ? Math.max(preview.outstanding - settled, 0) : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant?.contractId) return;

    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/move-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractId: tenant.contractId,
          endDate: form.get("endDate"),
          reason: form.get("reason"),
          deductions: deductions === "" ? 0 : deductions,
          deductionNote: form.get("deductionNote"),
          finalReading: finalReading === "" ? null : finalReading,
          issueFinalInvoice: issueFinal,
        }),
      });
      const payload = (await response.json()) as MoveOutResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không trả phòng được.");
        return;
      }
      setResult(payload);
      onDone();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setLoadedFor(null);
    setPreview(null);
    setResult(null);
    setError("");
    onClose();
  }

  return (
    <Modal open={!!tenant} onClose={close} wide>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">KẾT THÚC HỢP ĐỒNG</span>
          <h2>Trả phòng {preview?.roomCode ?? tenant?.roomCode}</h2>
          <p>{tenant?.fullName} · {preview?.propertyName ?? tenant?.propertyName}</p>
        </div>
        <button className="icon-button" onClick={close} aria-label="Đóng"><X size={20} /></button>
      </div>

      {result ? (
        <div className="booking-success">
          <span><Check size={28} /></span>
          <h2>Đã trả phòng</h2>
          <div className="detail-list settle-list">
            {result.closingInvoice && (
              <div>
                <span>Đơn chốt tháng cuối {result.closingInvoice.code}</span>
                <strong>{money.format(result.closingInvoice.total)}đ</strong>
              </div>
            )}
            <div><span>Cấn vào tiền còn nợ</span><strong>{money.format(result.settledFromDeposit)}đ</strong></div>
            <div><span>Khấu trừ giữ lại</span><strong>{money.format(result.deductionKept)}đ</strong></div>
            {result.electricityDeducted > 0 && (
              <div>
                <span>Trong đó tiền điện chốt cuối</span>
                <strong>{money.format(result.electricityDeducted)}đ</strong>
              </div>
            )}
            <div><span>Hoàn lại cho khách</span><strong className="paid">{money.format(result.refund)}đ</strong></div>
            {result.stillOwed > 0 && (
              <div><span>Khách còn nợ</span><strong className="debt">{money.format(result.stillOwed)}đ</strong></div>
            )}
          </div>
          {result.stillOwed > 0 && (
            <p className="modal-hint">
              Tiền cọc không đủ bù. Các đơn còn nợ vẫn giữ nguyên để theo dõi, không tự xóa.
            </p>
          )}
          <button className="primary-button" onClick={close}>Xong</button>
        </div>
      ) : !preview ? (
        <div className="empty-state">
          {error ? <span className="debt">{error}</span> : "Đang tải thông tin hợp đồng..."}
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="settle-summary">
            <div><span>Tiền cọc đã thu</span><strong>{money.format(preview.deposit)}đ</strong></div>
            <div>
              <span>Đang còn nợ</span>
              <strong className={preview.outstanding > 0 ? "debt" : "paid"}>
                {money.format(preview.outstanding)}đ
              </strong>
            </div>
          </div>

          {preview.unpaidInvoices.length > 0 && (
            <div className="note-box">
              <strong>{preview.unpaidInvoices.length} đơn chưa thu đủ</strong>
              {preview.unpaidInvoices.map((invoice) => (
                <p key={invoice.id}>
                  {invoice.code} · kỳ {invoice.period} · còn {money.format(invoice.remaining)}đ
                </p>
              ))}
            </div>
          )}

          <div className="form-grid">
            <label>
              Ngày trả phòng
              <input
                name="endDate"
                type="date"
                required
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <label>
              Khấu trừ hư hỏng, vệ sinh
              <div className="money-input">
                <input
                  type="number"
                  min={0}
                  value={deductions}
                  placeholder="0"
                  onChange={(event) => setDeductions(event.target.value)}
                />
                <span>VNĐ</span>
              </div>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Chỉ số điện lúc trả phòng
              <input
                type="number"
                min={preview.lastReading ?? 0}
                value={finalReading}
                placeholder={
                  preview.lastReading === null
                    ? "Số trên công tơ"
                    : `Đã chốt gần nhất: ${preview.lastReading}`
                }
                onChange={(event) => setFinalReading(event.target.value)}
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={issueFinal}
                onChange={(event) => setIssueFinal(event.target.checked)}
              />
              Lập đơn chốt tháng cuối và cấn vào cọc
            </label>
          </div>
          <p className="modal-hint">
            {issueFinal
              ? "Nếu tháng trả phòng chưa có đơn, hệ thống lập đơn chốt: tiền phòng tính tới ngày trả, điện tính tới chỉ số trên. Nếu tháng đó đã có đơn, phần điện dùng thêm được trừ vào cọc."
              : "Không thu thêm gì cho tháng cuối. Chỉ số điện (nếu nhập) vẫn được ghi lại để khách sau không phải trả phần điện của khách này."}
          </p>
          <label>Lý do trả phòng<input name="reason" placeholder="Hết hạn hợp đồng, chuyển chỗ ở..." /></label>
          <label>Ghi chú khấu trừ<input name="deductionNote" placeholder="Vỡ kính, sơn lại tường..." /></label>

          <div className="settle-result">
            <div><span>Cấn vào tiền còn nợ</span><b>− {money.format(settled)}đ</b></div>
            <div><span>Khấu trừ giữ lại</span><b>− {money.format(kept)}đ</b></div>
            <div className="settle-total">
              <span>Hoàn lại cho khách{issueFinal ? " (chưa trừ tháng cuối)" : ""}</span>
              <b>{money.format(refund)}đ</b>
            </div>
            {stillOwed > 0 && (
              <div><span className="debt">Cọc không đủ, khách còn nợ</span><b className="debt">{money.format(stillOwed)}đ</b></div>
            )}
          </div>

          <p className="modal-hint">
            Kết thúc hợp đồng không hoàn tác được. Phòng {preview.roomCode} sẽ chuyển sang
            trống và cho thuê lại được ngay.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button danger" type="submit" disabled={busy}>
            <LogOut size={16} /> {busy ? "Đang xử lý..." : "Xác nhận trả phòng"}
          </button>
        </form>
      )}
    </Modal>
  );
}
