"use client";

import { BedDouble, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export function LoginClient() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);

  // Đếm ngược thời gian tạm khóa. Chỉ là tiện ích hiển thị; việc chặn thật nằm
  // ở máy chủ, tải lại trang không bỏ qua được.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = window.setInterval(() => setLockedFor((left) => Math.max(left - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [lockedFor]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string; retryAfterSeconds?: number };
        setError(payload.error ?? "Đăng nhập không thành công.");
        // 429 = bị tạm khóa; chặn luôn nút gửi cho tới khi hết thời gian chờ.
        if (response.status === 429 && payload.retryAfterSeconds) {
          setLockedFor(payload.retryAfterSeconds);
        }
        return;
      }

      // Dùng điều hướng cứng để máy chủ đọc lại cookie phiên vừa đặt.
      window.location.href = "/";
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
        <h1>Đăng nhập</h1>
        <p className="login-sub">Khu quản trị chứa thông tin khách thuê và công nợ.</p>

        <form onSubmit={submit}>
          <label>
            Email hoặc tên đăng nhập
            {/* Cố ý không dùng type="email": tài khoản có thể là tên đăng nhập ngắn. */}
            <input name="email" type="text" required autoComplete="username" placeholder="quanly@hoangan.vn" />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={busy || lockedFor > 0}>
            <LogIn size={16} />
            {lockedFor > 0
              ? `Thử lại sau ${lockedFor} giây`
              : busy
                ? "Đang kiểm tra..."
                : "Đăng nhập"}
          </button>
        </form>

        <p className="login-note">
          <ShieldCheck size={14} /> Khách thuê tìm phòng thì vào <a href="/booking">trang đặt phòng</a>.
        </p>
      </section>
    </main>
  );
}
