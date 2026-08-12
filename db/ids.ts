/**
 * Khóa chính dạng text do ứng dụng tự sinh.
 *
 * Chọn text thay vì AUTOINCREMENT để schema chuyển được sang PostgreSQL mà
 * không phải đổi kiểu khóa hay viết lại sequence. Tiền tố giúp đọc log dễ hơn.
 */
export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

/** Ngày dạng lịch `YYYY-MM-DD`, không kèm giờ hay múi giờ. */
export type CalendarDate = string;

export function today(): CalendarDate {
  return new Date().toISOString().slice(0, 10);
}
