/**
 * Định dạng khóa TOTP cho dễ nhập tay.
 *
 * Để riêng khỏi `db/totp.ts` vì file đó nằm trong nhánh import của
 * `cloudflare:workers`; client component import thẳng sẽ kéo mã máy chủ vào
 * bundle trình duyệt.
 */
export function formatSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
