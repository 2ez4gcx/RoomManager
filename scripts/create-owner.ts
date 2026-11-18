/**
 * Sinh câu lệnh SQL tạo tài khoản chủ nhà đầu tiên.
 *
 * Cần cho lần deploy đầu: cơ sở dữ liệu thật trống, chưa có ai để đăng nhập,
 * mà route nạp dữ liệu mẫu thì bị khóa ngoài môi trường phát triển — cố ý,
 * vì nó xóa sạch dữ liệu.
 *
 * Chỉ dành cho D1 trên Cloudflare (`--remote`). Bản chạy ở máy có đường riêng
 * là `POST /api/dev/create-owner`, xem `khoi-tao-that.bat` — đường đó nói
 * chuyện với chính tiến trình đang phục vụ trình duyệt nên không thể ghi nhầm
 * cơ sở dữ liệu.
 *
 * Dùng chung `db/password-hash.ts` với máy chủ nên định dạng băm chắc chắn
 * khớp; có bài kiểm thử đối chiếu giữa Node và workerd.
 *
 *   node scripts/create-owner.ts "email@example.com" "Họ Tên" "mật khẩu" [số điện thoại]
 */
import { writeFile } from "node:fs/promises";
import { hashPassword } from "../db/password-hash.ts";

const [email, fullName, password, phone] = process.argv.slice(2);

if (!email || !fullName || !password) {
  console.error('Cách dùng: node scripts/create-owner.ts "email" "Họ Tên" "mật khẩu" [số điện thoại]');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Mật khẩu phải có ít nhất 8 ký tự.");
  process.exit(1);
}

/** Nháy đơn trong SQL được thoát bằng cách nhân đôi. */
function quote(value: string | undefined) {
  if (value === undefined || value === "") return "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}

const id = `usr_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
const hash = await hashPassword(password);
const login = email.trim().toLowerCase();

const sql = [
  "INSERT INTO users",
  "(id, email, full_name, phone, password_hash, role, is_active, created_at, updated_at)",
  "VALUES (",
  [
    quote(id),
    quote(login),
    quote(fullName.trim()),
    quote(phone),
    quote(hash),
    "'owner'",
    "1",
    "(unixepoch() * 1000)",
    "(unixepoch() * 1000)",
  ].join(", "),
  ");",
].join(" ");

// Ghi ra file thay vì in một lệnh `--command "..."` để dán: chuỗi băm có dạng
// `pbkdf2$100000$...`, và trong nháy kép cả bash lẫn PowerShell đều coi `$...`
// là biến rồi thay bằng chuỗi rỗng. Lệnh vẫn báo thành công, nhưng mật khẩu
// lưu vào là một chuỗi băm hỏng và không ai đăng nhập được.
const sqlFile = "tao-chu-nha.sql";
await writeFile(sqlFile, `${sql}\n`, "utf8");

console.log("");
console.log(`Đã ghi câu lệnh tạo tài khoản vào file ${sqlFile}.`);
console.log("Chạy lệnh sau để áp lên cơ sở dữ liệu thật ở Cloudflare:");
console.log("");
console.log(`  npx wrangler d1 execute <TEN_DATABASE> --remote --file=${sqlFile}`);
console.log("");
console.log(`Chạy xong thì XÓA file ${sqlFile}: nó chứa chuỗi băm mật khẩu.`);
console.log("");
console.log("Bản chạy ở máy (chay-server.bat) thì không dùng lệnh trên: wrangler mở một");
console.log("file SQLite khác với file server đang dùng. Chạy khoi-tao-that.bat.");
console.log("");
console.log(`Đăng nhập:  ${login}  /  (mật khẩu vừa nhập)`);
console.log("");
console.log("Lưu ý: mật khẩu đang nằm trong lịch sử lệnh của terminal.");
console.log("Xóa lịch sử hoặc đổi mật khẩu ở trang Cài đặt sau khi đăng nhập lần đầu.");
console.log("");
