/**
 * Hằng số về mật khẩu, dùng chung cho cả máy chủ và trình duyệt.
 *
 * Để riêng ở đây vì `db/auth.ts` import `cloudflare:workers`; client component
 * mà import thẳng từ đó sẽ kéo mã máy chủ vào bundle trình duyệt.
 */
export const MIN_PASSWORD_LENGTH = 8;
