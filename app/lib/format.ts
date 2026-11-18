/** Định dạng hiển thị dùng chung. Tiền luôn là số nguyên VNĐ. */

const numberFormat = new Intl.NumberFormat("vi-VN");

/**
 * Ngày hôm nay theo giờ Việt Nam, dạng `YYYY-MM-DD`.
 *
 * `new Date().toISOString()` là giờ UTC: từ 0 giờ tới 7 giờ sáng ở Việt Nam nó
 * vẫn trả về hôm qua, nên ô ngày mặc định trong các biểu mẫu lệch một ngày (và
 * lệch một kỳ vào sáng mùng 1). Cố định múi giờ thay vì lấy theo trình duyệt
 * để máy chủ và trình duyệt kết xuất ra cùng một giá trị.
 */
export function todayVietnam() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `count` kỳ gần nhất tính từ tháng hiện tại (giờ Việt Nam), mới trước cũ sau. */
export function recentPeriods(count = 6) {
  const [year, month] = todayVietnam().split("-").map(Number);
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - 1 - index, 1)).toISOString().slice(0, 7),
  );
}

export const money = numberFormat;

export function formatMoney(amount: number) {
  return `${numberFormat.format(amount)}đ`;
}

/** Rút gọn sang triệu đồng cho thẻ chỉ số, ví dụ 108600000 → "108,6 tr". */
export function formatMillions(amount: number) {
  return `${numberFormat.format(Math.round(amount / 100_000) / 10)} tr`;
}

/** `2026-08-15` → `15/08/2026`. */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/** `2026-08-15` → `15/08`. */
export function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [, month, day] = iso.split("-");
  return month && day ? `${day}/${month}` : iso;
}

export function initials(fullName: string) {
  return fullName.split(" ").slice(-2).map((part) => part[0] ?? "").join("");
}
