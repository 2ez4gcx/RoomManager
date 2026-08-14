"use client";

import { BedDouble, Check, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "../lib/auth-constants";

export function ResetPasswordClient({
  token,
  valid,
  fullName,
}: {
  token: string;
  valid: boolean;
  fullName: string | null;
}) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError("Hai lần nhập mật khẩu mới không khớp.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword: form.get("confirmPassword"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không đặt lại được mật khẩu.");
        return;
      }
      setDone(true);
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark"><BedDouble size={20} strokeWidth={2.2} /></span>
          <strong>RoomManager</strong>
        </div>

        {done ? (
          <>
            <h1>Đã đặt mật khẩu mới</h1>
            <p className="login-sub">
              Mọi thiết bị đang đăng nhập tài khoản này đã bị đăng xuất. Đăng nhập lại
              bằng mật khẩu vừa đặt.
            </p>
            <a className="submit-button" href="/login"><Check size={16} /> Tới trang đăng nhập</a>
          </>
        ) : !valid ? (
          <>
            <h1>Link không dùng được</h1>
            <p className="login-sub">
              Link đã hết hạn, đã được dùng, hoặc không đúng. Nhờ chủ nhà cấp link mới —
              mỗi link chỉ sống một giờ và dùng được một lần.
            </p>
            <div className="security-callout">
              <TriangleAlert size={22} />
              <div>
                <strong>Không có gì thay đổi</strong>
                <p>Mật khẩu hiện tại của bạn vẫn giữ nguyên.</p>
              </div>
            </div>
            <p className="login-note"><a href="/login">Quay lại trang đăng nhập</a></p>
          </>
        ) : (
          <>
            <h1>Đặt lại mật khẩu</h1>
            <p className="login-sub">
              Cho tài khoản <strong>{fullName}</strong>. Link này chỉ dùng được một lần.
            </p>
            <form onSubmit={submit}>
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
              <p className="modal-hint">Tối thiểu {MIN_PASSWORD_LENGTH} ký tự.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="submit-button" type="submit" disabled={busy}>
                <KeyRound size={16} /> {busy ? "Đang lưu..." : "Đặt mật khẩu mới"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
