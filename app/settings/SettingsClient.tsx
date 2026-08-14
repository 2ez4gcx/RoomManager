"use client";

import {
  Building2, Check, ChevronRight, CreditCard, KeyRound, Save,
  ShieldCheck, UserCog, X, Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell, Modal, PageHeader } from "../components/AppShell";
import { QrCode } from "../components/QrCode";
import { formatDate } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import { MIN_PASSWORD_LENGTH } from "../lib/auth-constants";
import { formatSecret } from "../lib/totp-format";
import type { PropertyOption } from "../../db/queries";
import type { SettingKey } from "../../db/settings";
import type { TwoFactorStatus } from "../../db/two-factor";

export function SettingsClient({
  settings, properties, twoFactor, currentUser,
}: {
  settings: Record<SettingKey, string>;
  properties: PropertyOption[];
  twoFactor: TwoFactorStatus;
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);

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
                <button className="secondary-button" type="button" onClick={() => setChangingPassword(true)}>
                  <KeyRound size={15} /> Đổi mật khẩu
                </button>
              </div>
              <div className={`security-callout ${twoFactor.enabled ? "callout-ok" : ""}`}>
                <ShieldCheck size={22} />
                {twoFactor.enabled ? (
                  <div>
                    <strong>Xác thực hai bước đang bật</strong>
                    <p>
                      Còn {twoFactor.recoveryCodesLeft} mã khôi phục chưa dùng.
                      {twoFactor.recoveryCodesLeft <= 2 &&
                        " Nên tắt rồi bật lại để nhận bộ mã mới."}
                    </p>
                  </div>
                ) : (
                  <div>
                    <strong>Xác thực hai bước chưa được bật</strong>
                    <p>Thêm một lớp bảo vệ nữa: người biết mật khẩu vẫn cần điện thoại của bạn.</p>
                  </div>
                )}
                <button type="button" onClick={() => setTwoFactorOpen(true)}>
                  {twoFactor.enabled ? "Quản lý" : "Bật 2FA"}
                </button>
              </div>
            </section>
          </div>
        </section>
      </form>

      {/* Ngoài thẻ form của trang: HTML không cho lồng form trong form. */}
      <ChangePasswordModal
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
      />
      <TwoFactorModal
        open={twoFactorOpen}
        status={twoFactor}
        onClose={() => setTwoFactorOpen(false)}
        onChanged={() => router.refresh()}
      />
    </AppShell>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");

    // Đối chiếu sớm để khỏi gửi mật khẩu lên máy chủ khi biết chắc là sai.
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError("Hai lần nhập mật khẩu mới không khớp.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword,
          confirmPassword: form.get("confirmPassword"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không đổi được mật khẩu.");
        return;
      }
      setDone(true);
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setError("");
    setDone(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={close}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">BẢO MẬT</span>
          <h2>Đổi mật khẩu</h2>
          <p>Cần nhập mật khẩu hiện tại để xác nhận đúng là chủ tài khoản.</p>
        </div>
        <button className="icon-button" onClick={close} aria-label="Đóng"><X size={20} /></button>
      </div>

      {done ? (
        <div className="booking-success">
          <span><Check size={28} /></span>
          <h2>Đã đổi mật khẩu</h2>
          <p>
            Lần đăng nhập sau hãy dùng mật khẩu mới. Mọi thiết bị khác đang đăng nhập
            tài khoản này đã bị đăng xuất.
          </p>
          <button className="primary-button" onClick={close}>Hoàn tất</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label>
            Mật khẩu hiện tại
            <input name="currentPassword" type="password" required autoComplete="current-password" />
          </label>
          <label>
            Mật khẩu mới
            <input
              name="newPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input name="confirmPassword" type="password" required autoComplete="new-password" />
          </label>
          <p className="modal-hint">Tối thiểu {MIN_PASSWORD_LENGTH} ký tự và phải khác mật khẩu hiện tại.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={busy}>
            <KeyRound size={16} /> {busy ? "Đang đổi..." : "Đổi mật khẩu"}
          </button>
        </form>
      )}
    </Modal>
  );
}

/**
 * Hộp thoại bật/tắt xác thực hai bước.
 *
 * Bật gồm hai bước: lấy khóa, rồi nhập một mã đúng để xác nhận. Chỉ khi mã
 * đúng mới bật thật — người quét hụt sẽ không tự khóa mình ra khỏi hệ thống.
 */
function TwoFactorModal({
  open, status, onClose, onChanged,
}: {
  open: boolean;
  status: TwoFactorStatus;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUri: string;
    qrMatrix: string[];
  } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/two-factor", { method: "POST" });
      const payload = (await response.json()) as {
        secret?: string;
        otpauthUri?: string;
        qrMatrix?: string[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được khóa.");
        return;
      }
      setSetup({
        secret: payload.secret!,
        otpauthUri: payload.otpauthUri!,
        qrMatrix: payload.qrMatrix ?? [],
      });
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  async function send(method: "PUT" | "DELETE", event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/two-factor", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      const payload = (await response.json()) as { error?: string; recoveryCodes?: string[] };
      if (!response.ok) {
        setError(payload.error ?? "Thao tác không thành công.");
        return;
      }
      if (method === "PUT") setCodes(payload.recoveryCodes ?? []);
      else close();
      onChanged();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setSetup(null);
    setCodes(null);
    setError("");
    setBusy(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} wide>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">BẢO MẬT</span>
          <h2>Xác thực hai bước</h2>
          <p>Mỗi lần đăng nhập sẽ cần thêm mã 6 số từ điện thoại.</p>
        </div>
        <button className="icon-button" onClick={close} aria-label="Đóng"><X size={20} /></button>
      </div>

      {codes ? (
        <div className="recovery-block">
          <strong>Đã bật xong. Lưu lại các mã khôi phục sau:</strong>
          <p className="modal-hint">
            Dùng khi mất điện thoại. Mỗi mã chỉ dùng được một lần, và đây là lần
            duy nhất chúng hiện ra — hệ thống chỉ lưu bản băm. Chụp màn hình hoặc
            chép ra giấy cất nơi an toàn.
          </p>
          <ul className="recovery-codes">
            {codes.map((code) => <li key={code}>{code}</li>)}
          </ul>
          <button className="submit-button" type="button" onClick={close}>Tôi đã lưu xong</button>
        </div>
      ) : status.enabled ? (
        <form onSubmit={(event) => send("DELETE", event)}>
          <p className="modal-hint">
            Đang bật từ {status.enabledAt ? formatDate(status.enabledAt.slice(0, 10)) : "—"}.
            Còn {status.recoveryCodesLeft} mã khôi phục chưa dùng.
          </p>
          <label>
            Nhập mã hiện tại để tắt
            <input name="code" required inputMode="numeric" placeholder="123456" autoComplete="one-time-code" />
          </label>
          <p className="modal-hint">
            Bắt nhập mã để người mượn máy lúc bạn đang đăng nhập không tắt hộ được.
            Có thể dùng một mã khôi phục thay cho mã trên ứng dụng.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button danger" type="submit" disabled={busy}>
            {busy ? "Đang tắt..." : "Tắt xác thực hai bước"}
          </button>
        </form>
      ) : setup ? (
        <form onSubmit={(event) => send("PUT", event)}>
          <div className="form-section-title">Bước 1 — thêm vào ứng dụng xác thực</div>
          <p className="modal-hint">
            Mở Google Authenticator, Authy hoặc ứng dụng tương đương, chọn thêm tài khoản
            rồi quét mã dưới đây.
          </p>
          <div className="qr-wrap">
            <QrCode matrix={setup.qrMatrix} />
          </div>
          <details className="uri-details">
            <summary>Không quét được? Nhập khóa thủ công</summary>
            <div className="secret-box">{formatSecret(setup.secret)}</div>
            <p className="modal-hint">
              Trong ứng dụng chọn &ldquo;nhập khóa thủ công&rdquo; rồi gõ chuỗi trên.
              Loại khóa để mặc định là theo thời gian.
            </p>
            <code>{setup.otpauthUri}</code>
          </details>

          <div className="form-section-title">Bước 2 — xác nhận</div>
          <label>
            Mã 6 số đang hiện trên ứng dụng
            <input name="code" required inputMode="numeric" placeholder="123456" autoComplete="one-time-code" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={busy}>
            <ShieldCheck size={16} /> {busy ? "Đang kiểm tra..." : "Xác nhận và bật"}
          </button>
        </form>
      ) : (
        <div>
          <p className="modal-hint">
            Sau khi bật, đăng nhập sẽ cần mật khẩu và mã 6 số đổi mỗi 30 giây trên
            điện thoại. Bạn sẽ nhận 8 mã khôi phục dùng khi mất máy.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="button" onClick={begin} disabled={busy}>
            <ShieldCheck size={16} /> {busy ? "Đang tạo khóa..." : "Bắt đầu cài đặt"}
          </button>
        </div>
      )}
    </Modal>
  );
}
