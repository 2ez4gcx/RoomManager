"use client";

import {
  Building2, Check, ChevronRight, CreditCard, KeyRound, Save,
  ShieldCheck, UserCog, Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell, PageHeader } from "../components/AppShell";
import type { SessionUser } from "../../db/auth";
import type { PropertyOption } from "../../db/queries";
import type { SettingKey } from "../../db/settings";

export function SettingsClient({
  settings, properties, currentUser,
}: {
  settings: Record<SettingKey, string>;
  properties: PropertyOption[];
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const readOnly = currentUser.role !== "owner";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không lưu được thiết lập.");
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell currentUser={currentUser} searchPlaceholder="Tìm cài đặt...">
      <form className="content settings-content" onSubmit={save}>
        <PageHeader
          eyebrow="HỆ THỐNG"
          title="Cài đặt"
          description="Thông tin vận hành, bảng giá và quyền truy cập."
        >
          {!readOnly && (
            <button className="primary-button" type="submit" disabled={busy}>
              {saved ? <Check size={16} /> : <Save size={16} />}
              {saved ? "Đã lưu" : busy ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          )}
        </PageHeader>

        {readOnly && (
          <p className="modal-hint">
            Tài khoản nhân viên chỉ xem được thiết lập. Liên hệ chủ nhà để thay đổi.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="settings-layout">
          <nav className="settings-nav">
            <a className="active" href="#general"><Building2 size={17} /> Thông tin nhà trọ<ChevronRight size={15} /></a>
            <a href="#rates"><Zap size={17} /> Bảng giá & phụ thu<ChevronRight size={15} /></a>
            <a href="#billing"><CreditCard size={17} /> Chu kỳ thanh toán<ChevronRight size={15} /></a>
            <a href="#team"><UserCog size={17} /> Nhà đang quản lý<ChevronRight size={15} /></a>
            <a href="#security"><ShieldCheck size={17} /> Bảo mật<ChevronRight size={15} /></a>
          </nav>

          <div className="settings-panels">
            <section className="panel settings-panel" id="general">
              <div className="panel-heading">
                <div><h2>Thông tin nhà trọ</h2><p>Thông tin hiển thị trong hệ thống và trên đơn thu.</p></div>
              </div>
              <div className="settings-body">
                <div className="form-grid">
                  <label>Tên đơn vị<input name="org.name" defaultValue={settings["org.name"]} disabled={readOnly} /></label>
                  <label>Số điện thoại<input name="org.phone" defaultValue={settings["org.phone"]} disabled={readOnly} /></label>
                </div>
                <label>Email quản lý<input name="org.email" type="email" defaultValue={settings["org.email"]} disabled={readOnly} /></label>
                <label>Địa chỉ xuất trên đơn<input name="org.address" defaultValue={settings["org.address"]} disabled={readOnly} /></label>
              </div>
            </section>

            <section className="panel settings-panel" id="rates">
              <div className="panel-heading">
                <div>
                  <h2>Bảng giá mặc định</h2>
                  <p>Dùng khi lập đơn thu mới. Đơn đã lập giữ nguyên đơn giá cũ.</p>
                </div>
              </div>
              <div className="settings-body rate-grid">
                <label>Đơn giá điện<div className="setting-unit"><input name="rate.electricity" type="number" min={0} defaultValue={settings["rate.electricity"]} disabled={readOnly} /><span>đ/kWh</span></div></label>
                <label>Đơn giá nước<div className="setting-unit"><input name="rate.water" type="number" min={0} defaultValue={settings["rate.water"]} disabled={readOnly} /><span>đ/người</span></div></label>
                <label>Phí dịch vụ<div className="setting-unit"><input name="rate.service" type="number" min={0} defaultValue={settings["rate.service"]} disabled={readOnly} /><span>đ/phòng</span></div></label>
                <label>Phí giữ xe<div className="setting-unit"><input name="rate.parking" type="number" min={0} defaultValue={settings["rate.parking"]} disabled={readOnly} /><span>đ/xe</span></div></label>
              </div>
            </section>

            <section className="panel settings-panel" id="billing">
              <div className="panel-heading">
                <div><h2>Chu kỳ thanh toán</h2><p>Áp dụng cho hợp đồng tạo mới.</p></div>
              </div>
              <div className="settings-body rate-grid">
                <label>Ngày thu hàng tháng<div className="setting-unit"><input name="billing.defaultDay" type="number" min={1} max={28} defaultValue={settings["billing.defaultDay"]} disabled={readOnly} /><span>hằng tháng</span></div></label>
                <label>Thời gian giữ phòng<div className="setting-unit"><input name="booking.holdDays" type="number" min={1} max={30} defaultValue={settings["booking.holdDays"]} disabled={readOnly} /><span>ngày</span></div></label>
              </div>
            </section>

            <section className="panel settings-panel" id="team">
              <div className="panel-heading">
                <div><h2>Nhà đang quản lý</h2><p>Thêm nhà mới ở trang Nhà &amp; phòng.</p></div>
              </div>
              <div className="settings-body">
                <div className="detail-list">
                  {properties.map((property) => (
                    <div key={property.id}>
                      <span>{property.code} · {property.address || "Chưa có địa chỉ"}</span>
                      <strong>{property.name}</strong>
                    </div>
                  ))}
                  {properties.length === 0 && <div className="empty-state">Chưa có nhà nào.</div>}
                </div>
              </div>
            </section>

            <section className="panel settings-panel" id="security">
              <div className="panel-heading">
                <div><h2>Bảo mật tài khoản</h2><p>Đang đăng nhập: {currentUser.email}</p></div>
                <button className="secondary-button" type="button"><KeyRound size={15} /> Đổi mật khẩu</button>
              </div>
              <div className="security-callout">
                <ShieldCheck size={22} />
                <div>
                  <strong>Xác thực hai bước chưa được bật</strong>
                  <p>Nên bật trước khi đưa hệ thống lên Internet.</p>
                </div>
                <button type="button">Bật 2FA</button>
              </div>
            </section>
          </div>
        </section>
      </form>
    </AppShell>
  );
}
