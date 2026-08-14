/**
 * Cứu hộ khi chủ nhà duy nhất quên mật khẩu.
 *
 * Khi đó không ai cấp được link đặt lại, nên phải sửa thẳng cơ sở dữ liệu.
 * Script này sinh chuỗi băm để dán vào câu lệnh UPDATE.
 *
 * Dùng chung `db/password-hash.ts` với máy chủ nên định dạng băm chắc chắn
 * khớp — không có chuyện script sinh ra thứ mà ứng dụng không đọc được.
 *
 *   node scripts/hash-password.ts "mat khau moi"
 *   node scripts/hash-password.ts --verify "mat khau" "pbkdf2$..."
 */
import { hashPassword, verifyPassword } from "../db/password-hash.ts";

const [first, ...rest] = process.argv.slice(2);

if (first === "--verify") {
  const [password, stored] = rest;
  if (!password || !stored) {
    console.error('Cách dùng: node scripts/hash-password.ts --verify "mật khẩu" "pbkdf2$..."');
    process.exit(1);
  }
  const ok = await verifyPassword(password, stored);
  console.log(ok ? "Khớp." : "KHÔNG khớp.");
  process.exit(ok ? 0 : 1);
}

const password = first;
if (!password) {
  console.error('Cách dùng: node scripts/hash-password.ts "mật khẩu mới"');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Mật khẩu phải có ít nhất 8 ký tự.");
  process.exit(1);
}

const hash = await hashPassword(password);

console.log("");
console.log("Chuỗi băm:");
console.log(hash);
console.log("");
console.log("Dán vào câu lệnh sau, thay email cho đúng tài khoản cần cứu:");
console.log("");
console.log(
  `  npx wrangler d1 execute <TEN_DATABASE> --remote --command "UPDATE users SET password_hash = '${hash}' WHERE email = 'quanly@hoangan.vn'"`,
);
console.log("");
console.log("Chạy ở máy local thì bỏ --remote.");
console.log("Xong nhớ đăng nhập rồi đổi mật khẩu ở trang Cài đặt.");
console.log("");
