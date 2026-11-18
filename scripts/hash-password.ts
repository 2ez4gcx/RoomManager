/**
 * Cứu hộ khi chủ nhà duy nhất quên mật khẩu.
 *
 * Khi đó không ai cấp được link đặt lại, nên phải sửa thẳng cơ sở dữ liệu.
 * Script này sinh chuỗi băm để dán vào câu lệnh UPDATE.
 *
 * Dùng chung `db/password-hash.ts` với máy chủ nên định dạng băm chắc chắn
 * khớp — không có chuyện script sinh ra thứ mà ứng dụng không đọc được.
 *
 *   node scripts/hash-password.ts "mat khau moi" "email-tai-khoan"
 *   node scripts/hash-password.ts --verify "mat khau" "pbkdf2$..."
 */
import { writeFile } from "node:fs/promises";
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
const email = rest[0]?.trim().toLowerCase();
if (!password || !email) {
  console.error('Cách dùng: node scripts/hash-password.ts "mật khẩu mới" "email tài khoản cần cứu"');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Mật khẩu phải có ít nhất 8 ký tự.");
  process.exit(1);
}

const hash = await hashPassword(password);

// Ghi ra file, không in lệnh `--command "..."`: chuỗi băm chứa ký tự `$`, dán
// vào nháy kép thì shell thay `$...` bằng chuỗi rỗng và ghi một chuỗi băm hỏng.
const sqlFile = "dat-lai-mat-khau.sql";
const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
await writeFile(
  sqlFile,
  [
    `UPDATE users SET password_hash = ${quoted(hash)}, updated_at = (unixepoch() * 1000) WHERE email = ${quoted(email)};`,
    // Thu hồi mọi phiên cũ của tài khoản đó.
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${quoted(email)});`,
    "",
  ].join("\n"),
  "utf8",
);

console.log("");
console.log(`Đã ghi câu lệnh đặt lại mật khẩu cho ${email} vào file ${sqlFile}.`);
console.log("Áp lên cơ sở dữ liệu ở Cloudflare bằng:");
console.log("");
console.log(`  npx wrangler d1 execute <TEN_DATABASE> --remote --file=${sqlFile}`);
console.log("");
console.log(`Chạy xong thì XÓA file ${sqlFile}, rồi đăng nhập và đổi mật khẩu ở trang Cài đặt.`);
console.log("");
console.log("Bản chạy ở máy (chay-server.bat) thì dùng lệnh riêng, sau khi tắt server:");
console.log("");
console.log("  node scripts/chay-server.mjs --dat-lai-mat-khau");
console.log("");
