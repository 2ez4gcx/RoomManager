/** Định dạng hiển thị dùng chung. Tiền luôn là số nguyên VNĐ. */

const numberFormat = new Intl.NumberFormat("vi-VN");

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
