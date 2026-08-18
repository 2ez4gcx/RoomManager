"use client";

import {
  ArrowRight, BedDouble, BellRing, Building2, CalendarDays, CreditCard, FilePlus2, FileText,
  LayoutDashboard, LogOut, Menu, Plus, Search, Settings, UserCog, Users, X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Điều hướng bằng thẻ `<a>` thường thay cho `next/link`.
 *
 * Router phía client của vinext 1.0.0-beta.2 hỏng ở bản build production: nó
 * chặn cú bấm rồi ném `TypeError: ee is not a function` trong chunk AppShell,
 * nên bấm menu đứng im, phải mở tab mới. Đã tái hiện ở cả bản chạy máy lẫn bản
 * trên Cloudflare — cùng một bản build, không phải lỗi riêng của nền tảng.
 *
 * Thẻ `<a>` tải lại cả trang. Chậm hơn một nhịp, nhưng mọi trang ở đây đều do
 * máy chủ kết xuất sẵn nên không mất trạng thái gì, và quan trọng hơn: nó chạy.
 * Bỏ được khi nào vinext sửa router và đã kiểm chứng trên bản deploy thật.
 */
function Link({
  href,
  className,
  onClick,
  children,
}: {
  href: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
import { useState } from "react";
import type { SessionUser } from "../../db/auth";
import { initials } from "../lib/format";

const navItems: Array<{ label: string; icon: typeof LayoutDashboard; href: string }> = [
  { label: "Tổng quan", icon: LayoutDashboard, href: "/" },
  { label: "Nhà & phòng", icon: Building2, href: "/rooms" },
  { label: "Khách thuê", icon: Users, href: "/tenants" },
  { label: "Đặt phòng", icon: CalendarDays, href: "/bookings" },
  { label: "Lập đơn thu", icon: FilePlus2, href: "/lap-don-thu" },
  { label: "Đơn & doanh thu", icon: FileText, href: "/invoices" },
  { label: "Thu chi", icon: CreditCard, href: "/cashflow" },
  { label: "Nhắc nợ", icon: BellRing, href: "/nhac-no" },
];

type AppShellProps = {
  children: React.ReactNode;
  currentUser: SessionUser;
  searchValue?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Số yêu cầu đặt phòng chưa xử lý; bỏ trống thì không hiện huy hiệu. */
  newBookingCount?: number;
  /** Số lời nhắc nợ chưa xử lý. */
  pendingReminderCount?: number;
};

export function AppShell({ children, currentUser, searchValue = "", onSearch, searchPlaceholder = "Tìm phòng, khách thuê...", actionLabel = "Tạo đơn thu", onAction, newBookingCount, pendingReminderCount }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // Điều hướng cứng để mọi dữ liệu đã tải của phiên cũ bị bỏ khỏi bộ nhớ.
    window.location.href = "/login";
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <Link href="/"><span className="brand-mark"><BedDouble size={20} strokeWidth={2.2} /></span><span>RoomManager</span></Link>
          <button type="button" className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Đóng menu"><X size={19} /></button>
        </div>
        <nav className="primary-nav" aria-label="Điều hướng chính">
          <p className="nav-label">QUẢN LÝ</p>
          {navItems.map(({ label, icon: Icon, href }) => (
            <Link className={`nav-item ${pathname === href ? "active" : ""}`} key={label} href={href} onClick={() => setMobileNav(false)}>
              <Icon size={18} /><span>{label}</span>
              {href === "/bookings" && !!newBookingCount && <span className="nav-badge">{newBookingCount}</span>}
              {href === "/nhac-no" && !!pendingReminderCount && (
                <span className="nav-badge">{pendingReminderCount}</span>
              )}
            </Link>
          ))}
          <p className="nav-label nav-label-spaced">HỆ THỐNG</p>
          {/* Quản lý tài khoản chỉ dành cho chủ nhà; máy chủ cũng chặn lại ở trang. */}
          {currentUser.role === "owner" && (
            <Link className={`nav-item ${pathname === "/users" ? "active" : ""}`} href="/users" onClick={() => setMobileNav(false)}>
              <UserCog size={18} /><span>Tài khoản</span>
            </Link>
          )}
          <Link className={`nav-item ${pathname === "/settings" ? "active" : ""}`} href="/settings" onClick={() => setMobileNav(false)}><Settings size={18} /><span>Cài đặt</span></Link>
        </nav>
        <div className="sidebar-card">
          <span className="sidebar-card-icon"><CalendarDays size={18} /></span>
          <p>Trang đặt phòng</p><span>Nơi khách xem phòng trống và gửi yêu cầu</span>
          <a href="/booking" target="_blank">Xem trang công khai <ArrowRight size={14} /></a>
        </div>
        <div className="user-chip">
          <span className="avatar">{initials(currentUser.fullName)}</span>
          <div><strong>{currentUser.fullName}</strong><span>{currentUser.role === "owner" ? "Chủ nhà" : "Nhân viên"}</span></div>
          <button type="button" className="icon-button sign-out" onClick={signOut} disabled={signingOut} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} /></button>
        </div>
      </aside>
      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Đóng menu" />}
      <section className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Mở menu"><Menu size={20} /></button>
          <div className="search-box"><Search size={17} /><input aria-label="Tìm kiếm" placeholder={searchPlaceholder} value={searchValue} onChange={(event) => onSearch?.(event.target.value)} /><kbd>Ctrl K</kbd></div>
          <div className="topbar-actions">{onAction && <button className="primary-button" onClick={onAction}><Plus size={17} /> {actionLabel}</button>}</div>
        </header>
        {children}
      </section>
    </main>
  );
}

export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{children}</div>;
}

export function StatusBadge({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "gold" | "red" | "gray" | "blue" | "pale" }) {
  return <span className={`ui-badge badge-${tone}`}>{children}</span>;
}

export function Modal({ open, onClose, children, wide = false }: { open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><div className={`entry-modal ${wide ? "modal-wide" : ""}`}>{children}</div></div>;
}
