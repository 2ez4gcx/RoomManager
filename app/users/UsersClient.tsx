"use client";

import {
  Copy, KeyRound, Link as LinkIcon, Lock, ShieldCheck, Unlock, UserPlus, Users, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { MIN_PASSWORD_LENGTH } from "../lib/auth-constants";
import { formatDate, initials } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { UserView } from "../../db/users";

export function UsersClient({
  users,
  currentUser,
}: {
  users: UserView[];
  currentUser: SessionUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserView | null>(null);
  const [linking, setLinking] = useState<UserView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) =>
      `${user.fullName} ${user.email} ${user.phone ?? ""}`.toLowerCase().includes(needle),
    );
  }, [query, users]);

  const summary = useMemo(
    () => ({
      total: users.length,
      owners: users.filter((user) => user.role === "owner" && user.isActive).length,
      locked: users.filter((user) => !user.isActive).length,
    }),
    [users],
  );

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    setBusy(id);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không thực hiện được thay đổi.");
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
      searchPlaceholder="Tìm tên, email..."
      actionLabel="Thêm tài khoản"
      onAction={() => setAdding(true)}
    >
      <div className="content">
        <PageHeader
          eyebrow="HỆ THỐNG"
          title="Tài khoản"
          description="Cấp quyền truy cập cho người cùng quản lý nhà trọ."
        />

        <section className="summary-cards three">
          <article>
            <span className="summary-icon green"><Users size={20} /></span>
            <div><small>Tổng tài khoản</small><strong>{summary.total}</strong><p>{summary.total - summary.locked} đang hoạt động</p></div>
          </article>
          <article>
            <span className="summary-icon blue"><ShieldCheck size={20} /></span>
            <div><small>Chủ nhà</small><strong>{summary.owners}</strong><p>Toàn quyền trên hệ thống</p></div>
          </article>
          <article>
            <span className="summary-icon red"><Lock size={20} /></span>
            <div><small>Đang khóa</small><strong>{summary.locked}</strong><p>Không đăng nhập được</p></div>
          </article>
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="panel data-table-wrap">
          <table className="data-table tenant-table">
            <thead>
              <tr>
                <th>Người dùng</th><th>Đăng nhập</th><th>Vai trò</th>
                <th>Tạo lúc</th><th>Phiên</th><th>Trạng thái</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const isSelf = user.id === currentUser.id;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="person-cell">
                        <span className="table-avatar">{initials(user.fullName)}</span>
                        <div>
                          <strong>{user.fullName}{isSelf && " (bạn)"}</strong>
                          <small>{user.phone ?? "Chưa có số điện thoại"}</small>
                        </div>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <select
                        value={user.role}
                        disabled={busy === user.id || isSelf}
                        title={isSelf ? "Không thể tự đổi vai trò của mình" : undefined}
                        onChange={(event) => patch(user.id, { role: event.target.value })}
                      >
                        <option value="owner">Chủ nhà</option>
                        <option value="staff">Nhân viên</option>
                      </select>
                    </td>
                    <td>{formatDate(user.createdAt.slice(0, 10))}</td>
                    <td>{user.activeSessions > 0 ? `${user.activeSessions} thiết bị` : "—"}</td>
                    <td>
                      <StatusBadge tone={user.isActive ? "green" : "gray"}>
                        {user.isActive ? "Hoạt động" : "Đã khóa"}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy === user.id}
                          title="Đặt mật khẩu mới ngay, dùng khi bạn tự chọn mật khẩu cho họ"
                          onClick={() => setResetting(user)}
                        >
                          <KeyRound size={14} /> Đặt lại mật khẩu
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy === user.id || !user.isActive}
                          title={
                            user.isActive
                              ? "Cấp link để người dùng tự đặt mật khẩu"
                              : "Tài khoản đang khóa"
                          }
                          onClick={() => setLinking(user)}
                        >
                          <LinkIcon size={14} /> Link quên mật khẩu
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy === user.id || isSelf}
                          title={isSelf ? "Không thể tự khóa tài khoản của mình" : undefined}
                          onClick={() => patch(user.id, { isActive: !user.isActive })}
                        >
                          {user.isActive ? <><Lock size={14} /> Khóa</> : <><Unlock size={14} /> Mở khóa</>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state">Không tìm thấy tài khoản phù hợp.</div>}
        </section>

        <p className="modal-hint">
          Tài khoản không bị xóa mà chỉ khóa, vì hợp đồng, phiếu thu và nhật ký thao tác
          đều ghi lại ai đã tạo. Khóa tài khoản sẽ đăng xuất người đó khỏi mọi thiết bị ngay lập tức.
        </p>
      </div>

      <AddUserModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          router.refresh();
        }}
      />
      <ResetLinkModal user={linking} onClose={() => setLinking(null)} />
      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={() => {
          setResetting(null);
          router.refresh();
        }}
      />
    </AppShell>
  );
}

function AddUserModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          fullName: form.get("fullName"),
          phone: form.get("phone"),
          password: form.get("password"),
          role: form.get("role"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được tài khoản.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">TÀI KHOẢN MỚI</span>
          <h2>Thêm tài khoản</h2>
          <p>Người được cấp sẽ đăng nhập bằng email hoặc tên đăng nhập bên dưới.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Họ và tên<input name="fullName" required placeholder="Nguyễn Văn A" /></label>
          <label>Số điện thoại<input name="phone" placeholder="09xxxxxxxx" /></label>
        </div>
        <label>
          Email hoặc tên đăng nhập
          <input name="email" required placeholder="nhanvien@nhatro.vn" />
        </label>
        <div className="form-grid">
          <label>
            Vai trò
            <select name="role" defaultValue="staff">
              <option value="staff">Nhân viên</option>
              <option value="owner">Chủ nhà</option>
            </select>
          </label>
          <label>
            Mật khẩu ban đầu
            <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} />
          </label>
        </div>
        <p className="modal-hint">
          Mật khẩu tối thiểu {MIN_PASSWORD_LENGTH} ký tự. Nhắc người dùng tự đổi ở trang Cài đặt sau lần đăng nhập đầu.
          Nhân viên xem được dữ liệu vận hành nhưng không sửa được bảng giá, không thêm nhà và không quản lý tài khoản.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={busy}>
          <UserPlus size={16} /> {busy ? "Đang tạo..." : "Tạo tài khoản"}
        </button>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user, onClose, onDone,
}: {
  user: UserView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: user.id, newPassword: form.get("newPassword") }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không đặt lại được mật khẩu.");
        return;
      }
      onDone();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!user} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">BẢO MẬT</span>
          <h2>Đặt lại mật khẩu</h2>
          <p>Cho tài khoản {user?.fullName} ({user?.email})</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <label>
          Mật khẩu mới
          <input name="newPassword" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </label>
        <p className="modal-hint">
          Tối thiểu {MIN_PASSWORD_LENGTH} ký tự. Người này sẽ bị đăng xuất khỏi mọi thiết bị và
          phải đăng nhập lại bằng mật khẩu mới. Hãy báo mật khẩu cho họ qua kênh riêng.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={busy}>
          <KeyRound size={16} /> {busy ? "Đang lưu..." : "Đặt lại mật khẩu"}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Hộp thoại cấp link đặt lại mật khẩu.
 *
 * Link hiện đúng một lần ở đây. Chủ nhà tự chuyển cho người dùng qua Zalo hoặc
 * gọi điện — hệ thống không gửi email vì chưa có dịch vụ gửi mail nào.
 */
function ResetLinkModal({
  user, onClose,
}: {
  user: UserView | null;
  onClose: () => void;
}) {
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!user) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const payload = (await response.json()) as {
        path?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được link.");
        return;
      }
      // Ghép với tên miền đang mở, để link dùng được đúng địa chỉ người dùng vào.
      setLink(`${window.location.origin}${payload.path}`);
      setExpiresAt(payload.expiresAt ?? "");
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Trình duyệt không cho sao chép tự động. Bôi đen link rồi copy thủ công.");
    }
  }

  function close() {
    setLink("");
    setExpiresAt("");
    setError("");
    setCopied(false);
    onClose();
  }

  return (
    <Modal open={!!user} onClose={close}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">QUÊN MẬT KHẨU</span>
          <h2>Cấp link đặt lại</h2>
          <p>Cho tài khoản {user?.fullName} ({user?.email})</p>
        </div>
        <button className="icon-button" onClick={close} aria-label="Đóng"><X size={20} /></button>
      </div>

      {link ? (
        <>
          <p className="modal-hint">
            Gửi link này cho người dùng qua Zalo hoặc đọc qua điện thoại. Link{" "}
            <strong>chỉ dùng được một lần</strong> và hết hạn lúc{" "}
            {expiresAt ? new Date(expiresAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—"}.
          </p>
          <div className="reset-link-box">{link}</div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={copy}>
              <Copy size={15} /> {copied ? "Đã sao chép" : "Sao chép link"}
            </button>
            <button className="primary-button" type="button" onClick={close}>Xong</button>
          </div>
          <p className="modal-hint">
            Người dùng đặt mật khẩu mới xong vẫn phải tự đăng nhập, nên tài khoản có bật
            xác thực hai bước vẫn bị hỏi mã như thường.
          </p>
        </>
      ) : (
        <>
          <p className="modal-hint">
            Dùng khi người này quên mật khẩu. Link sống một giờ, dùng một lần, và khi
            đặt lại xong mọi thiết bị đang đăng nhập tài khoản đó sẽ bị đăng xuất.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="button" onClick={create} disabled={busy}>
            <LinkIcon size={16} /> {busy ? "Đang tạo..." : "Tạo link đặt lại"}
          </button>
        </>
      )}
    </Modal>
  );
}
