/**
 * Băm và kiểm tra mật khẩu bằng PBKDF2-SHA256.
 *
 * Tách khỏi `db/auth.ts` vì file đó import `cloudflare:workers`. Ở đây chỉ dùng
 * Web Crypto — có sẵn cả trong Workers lẫn Node — nên script cứu hộ chạy ngoài
 * Workers vẫn dùng chung đúng mã này, không sợ lệch định dạng băm.
 *
 * Workers không chạy được bcrypt/argon2 vì đó là mã native.
 */
/**
 * Số vòng lặp PBKDF2.
 *
 * 100.000 là TRẦN CỨNG của runtime Cloudflare Workers, không phải lựa chọn:
 * đặt cao hơn thì Web Crypto ném "iteration counts above 100000 are not
 * supported" và không ai đăng nhập được. Trước đây con số này là 210.000 —
 * chạy tốt trên workerd ở máy vì bản local không áp giới hạn, nên 138 bài kiểm
 * thử đều xanh, và chỉ vỡ ra ở lần deploy thật đầu tiên.
 *
 * Đừng nâng lên nếu chưa thử đăng nhập trên một bản deploy thật.
 */
const PBKDF2_ITERATIONS = 100_000;

/** Trần của nền tảng. Vượt qua là Web Crypto từ chối. */
export const PBKDF2_MAX_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Trả về chuỗi `pbkdf2$<vòng lặp>$<muối>$<băm>` để lưu vào `users.password_hash`. */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** So sánh theo thời gian hằng số để không lộ thông tin qua thời gian phản hồi. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;

  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;

  const soVong = Number(iterations);
  // Chuỗi băm cũ có thể ghi số vòng vượt trần của nền tảng. Trả false thay vì
  // để Web Crypto ném lỗi — người dùng thấy "sai mật khẩu" và đi đặt lại, còn
  // hơn nhận màn hình lỗi 500 không hiểu gì.
  if (!Number.isFinite(soVong) || soVong <= 0 || soVong > PBKDF2_MAX_ITERATIONS) return false;

  const candidate = await derive(password, fromBase64(salt), soVong);
  return timingSafeEqual(candidate, fromBase64(hash));
}
