/**
 * TOTP theo RFC 6238 — mã 6 số đổi mỗi 30 giây, dùng với Google Authenticator,
 * Authy, 1Password và các ứng dụng tương đương.
 *
 * Chọn TOTP thay vì gửi mã qua SMS hoặc email vì hệ thống chưa có dịch vụ gửi
 * tin nào, và TOTP không phụ thuộc nhà mạng hay hộp thư.
 *
 * Thuật toán chuẩn dùng HMAC-SHA1. SHA-1 đã yếu với bài toán chống va chạm,
 * nhưng HMAC-SHA1 thì chưa bị phá, và mọi ứng dụng xác thực đều dùng nó — đổi
 * sang SHA-256 sẽ không quét được bằng ứng dụng phổ thông.
 */

/** Bảng mã Base32 theo RFC 4648, dạng ứng dụng xác thực đọc được. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Mỗi bước 30 giây, đúng mặc định của mọi ứng dụng xác thực. */
export const TOTP_STEP_SECONDS = 30;

/** Số bước chấp nhận lệch về hai phía, bù cho đồng hồ điện thoại chạy sai. */
export const TOTP_DRIFT_STEPS = 1;

const DIGITS = 6;

export function toBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

export function fromBase32(secret: string) {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

/** Sinh khóa bí mật 20 byte, đúng độ dài RFC khuyến nghị cho HMAC-SHA1. */
export function generateTotpSecret() {
  return toBase32(crypto.getRandomValues(new Uint8Array(20)));
}

/** Số thứ tự bước thời gian hiện tại. Dùng để chống dùng lại một mã. */
export function currentCounter(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

async function codeForCounter(secret: string, counter: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase32(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  // Bộ đếm là số nguyên 8 byte, big-endian.
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));

  // Cắt động theo RFC 4226: 4 bit cuối chỉ ra vị trí bắt đầu lấy 4 byte.
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function generateTotpCode(secret: string, counter = currentCounter()) {
  return codeForCounter(secret, counter);
}

export type TotpVerification = {
  valid: boolean;
  /** Bước thời gian đã khớp; lưu lại để không cho dùng lại chính mã đó. */
  counter: number | null;
};

/**
 * Kiểm tra mã người dùng nhập.
 *
 * `minCounter` là bước thời gian đã dùng lần trước. Mã thuộc bước đó hoặc cũ
 * hơn bị từ chối: nếu không, ai đó nhìn trộm màn hình vẫn kịp dùng lại mã trong
 * 30 giây còn hiệu lực.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  minCounter: number | null = null,
  atMs = Date.now(),
): Promise<TotpVerification> {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return { valid: false, counter: null };

  const now = currentCounter(atMs);

  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift += 1) {
    const counter = now + drift;
    if (minCounter !== null && counter <= minCounter) continue;
    if (cleaned === (await codeForCounter(secret, counter))) {
      return { valid: true, counter };
    }
  }

  return { valid: false, counter: null };
}

/**
 * Chuỗi `otpauth://` để ứng dụng xác thực nhận diện tài khoản.
 *
 * `issuer` hiện trong ứng dụng để người dùng biết mã này của hệ thống nào.
 */
export function otpauthUri(input: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export { formatSecret } from "../app/lib/totp-format";
