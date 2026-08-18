/**
 * Kiểm tra một bản deploy đang chạy có an toàn để giao cho người dùng chưa.
 *
 * Mục 7 của docs/DEPLOY-CLOUDFLARE.md vốn là danh sách gạch đầu dòng làm tay.
 * Hai mục trong đó hỏng thì hậu quả không sửa được: route dựng dữ liệu mở ra
 * Internet cho phép bất kỳ ai xoá sạch cơ sở dữ liệu, và trang đặt phòng công
 * khai lộ tên, số điện thoại hay công nợ của khách thuê. Danh sách làm tay thì
 * người ta bỏ qua, nên nó được viết lại thành lệnh chạy được.
 *
 * Chỉ gửi GET, không ghi một dòng dữ liệu nào, không đăng nhập, không gửi biểu
 * mẫu. Chạy bao nhiêu lần trên môi trường thật cũng được.
 *
 *   node scripts/kiem-tra-sau-deploy.mjs https://room-manager.<tên>.workers.dev
 */

const baseUrl = process.argv[2]?.replace(/\/+$/, "");

if (!baseUrl) {
  console.error("Cách dùng: node scripts/kiem-tra-sau-deploy.mjs <địa chỉ>");
  console.error("Ví dụ:     node scripts/kiem-tra-sau-deploy.mjs https://room-manager.abc.workers.dev");
  process.exit(2);
}

/** Mã của các thực thể riêng tư, không được xuất hiện ở trang công khai. */
const MA_RIENG_TU = [
  { ma: /\bKH-\d{3,}/g, ten: "mã khách thuê" },
  { ma: /\bHD-\d{3,}/g, ten: "mã hợp đồng" },
  { ma: /\bHĐ-\d{3,}/g, ten: "mã hợp đồng" },
  { ma: /\bTT-\d{3,}/g, ten: "mã phiếu thu" },
  { ma: /\bGD-\d{3,}/g, ten: "mã giao dịch" },
];

/** Chữ chỉ có ở khu quản trị. Lọt ra trang công khai là kết xuất nhầm dữ liệu. */
const TU_QUAN_TRI = ["công nợ", "còn nợ", "quá hạn", "khách thuê", "tiền cọc", "chỉ số điện"];

const ketQua = [];

function ghi(muc, dat, chiTiet, nghiemTrong = true) {
  ketQua.push({ muc, dat, chiTiet, nghiemTrong });
}

async function goi(duongDan, init = {}) {
  try {
    const res = await fetch(baseUrl + duongDan, { redirect: "manual", ...init });
    return { ok: true, res };
  } catch (error) {
    return { ok: false, loi: error instanceof Error ? error.message : String(error) };
  }
}

/* ---------------------------------------------------------------- */

/** Địa chỉ trong nhà: máy này, hoặc dải IP riêng của mạng nội bộ. */
function laMangNoiBo(dc) {
  const host = dc.replace(/^https?:\/\//, "").split(":")[0];
  return (
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function kiemTraKetNoi() {
  if (!baseUrl.startsWith("https://")) {
    const noiBo = laMangNoiBo(baseUrl);
    ghi(
      "Kết nối HTTPS",
      false,
      noiBo
        ? "Chạy trong mạng nội bộ nên không có HTTPS. Mật khẩu đi qua wifi ở dạng chữ thường, ai bắt được gói tin trong cùng mạng là đọc được. Chấp nhận khi mạng chỉ có thiết bị của mình."
        : `Địa chỉ dùng ${baseUrl.split(":")[0]}, không phải https`,
      // Mạng nội bộ thì đây là hạn chế không tránh được, ghi ra để biết chứ
      // không chặn — phép kiểm nào lúc nào cũng đỏ thì người ta thôi nhìn nó.
      !noiBo,
    );
  }

  const { ok, res, loi } = await goi("/login");
  if (!ok) {
    ghi("Mở được trang đăng nhập", false, loi);
    return false;
  }
  ghi("Mở được trang đăng nhập", res.status === 200, `HTTP ${res.status}`);
  return true;
}

async function kiemTraKhuQuanTri() {
  // Chưa đăng nhập mà vào được trang chủ nghĩa là cổng chặn đã hỏng.
  const { ok, res } = await goi("/");
  if (ok) {
    const bịĐẩyVềLogin = res.status >= 300 && res.status < 400;
    ghi(
      "Trang chủ đẩy người lạ về đăng nhập",
      bịĐẩyVềLogin,
      bịĐẩyVềLogin ? `HTTP ${res.status} → ${res.headers.get("location")}` : `HTTP ${res.status}`,
    );
  }

  for (const duongDan of ["/api/tenants", "/api/invoices", "/api/users", "/api/rooms"]) {
    const { ok: được, res: r } = await goi(duongDan);
    if (được) ghi(`${duongDan} từ chối người lạ`, r.status === 401, `HTTP ${r.status}`);
  }
}

async function kiemTraRouteDungDuLieu() {
  // Nhóm quan trọng nhất: route mở ra Internet cho phép bất kỳ ai xóa sạch dữ
  // liệu mà không cần đăng nhập.
  //
  // Hỏi qua /api/dev/status chứ tuyệt đối không POST thẳng vào /api/dev/setup.
  // POST vào đó để "xem có bị chặn không" thì đúng lúc phát hiện ra route đang
  // mở là đã xóa sạch cơ sở dữ liệu rồi — bản kiểm tra đầu tiên của script này
  // đã mắc đúng lỗi đó.
  const { ok, res } = await goi("/api/dev/status");
  if (!ok) return;

  if (res.status === 403) {
    ghi("Nhóm route /api/dev/ bị khóa", true, "HTTP 403");
    return;
  }

  if (res.status === 404) {
    ghi(
      "Nhóm route /api/dev/ bị khóa",
      false,
      "Bản deploy không có /api/dev/status nên không kiểm tự động được — POST thử /api/dev/setup bằng tay, phải ra 403",
      false,
    );
    return;
  }

  ghi(
    "Nhóm route /api/dev/ bị khóa",
    false,
    `HTTP ${res.status} — ALLOW_DEV_SETUP đang được đặt. Gỡ ngay: npx wrangler secret delete ALLOW_DEV_SETUP`,
  );
}

/**
 * Tải thử mọi CSS/JS/font mà trang khai báo.
 *
 * Lưu ý biểu thức bóc đường dẫn: HTML còn chứa payload RSC với chuỗi đã thoát
 * kiểu `\"/_next/...css\"`, nên phải loại cả dấu gạch chéo ngược ra khỏi tên
 * tệp. Thiếu chỗ đó thì địa chỉ bóc ra có đuôi thừa; ở máy Windows vẫn mở được
 * vì hệ tệp tự chuẩn hóa, nhưng lên Cloudflare thì trả 308 và lệnh báo hỏng oan.
 *
 * Chỉ kiểm mã trạng thái của HTML là chưa đủ, và đây không phải lo xa: bản
 * `chay-server.bat` đầu tiên trả 200 cho mọi trang trong khi 100% asset đều
 * 404 — giao diện trần trụi, client không hydrate — mà lệnh này vẫn báo đủ
 * mục đạt. Một cổng phát hành báo xanh sai còn tệ hơn không có cổng nào.
 */
async function kiemTraTaiNguyen(duongDanTrang) {
  const { ok, res } = await goi(duongDanTrang);
  if (!ok || res.status !== 200) return;

  const html = await res.text();
  const duongDan = [
    ...new Set(
      [...html.matchAll(/["'(](\/(?:_next|favicon|og)[^"')\\\s]*)/g)].map((m) => m[1]),
    ),
  ];

  if (duongDan.length === 0) {
    ghi(`Tài nguyên tĩnh của ${duongDanTrang}`, false, "trang không khai báo asset nào — bất thường");
    return;
  }

  const hong = [];
  for (const dd of duongDan) {
    const { ok: được, res: r } = await goi(dd);
    if (!được || r.status !== 200) hong.push(`${dd} (${được ? r.status : "không nối được"})`);
  }

  ghi(
    `Tài nguyên tĩnh của ${duongDanTrang}`,
    hong.length === 0,
    hong.length === 0
      ? `${duongDan.length}/${duongDan.length} tải được`
      : `${hong.length}/${duongDan.length} hỏng: ${hong.slice(0, 2).join(", ")}`,
  );
}

async function kiemTraTrangCongKhai() {
  const { ok, res } = await goi("/booking");
  if (!ok) return;

  ghi("Trang đặt phòng mở được", res.status === 200, `HTTP ${res.status}`);
  if (res.status !== 200) return;

  const html = await res.text();

  for (const { ma, ten } of MA_RIENG_TU) {
    const thay = [...new Set(html.match(ma) ?? [])];
    ghi(`Không lộ ${ten}`, thay.length === 0, thay.length ? thay.slice(0, 3).join(", ") : "sạch");
  }

  const thayTuQuanTri = TU_QUAN_TRI.filter((tu) => html.toLowerCase().includes(tu));
  ghi(
    "Không lộ chữ của khu quản trị",
    thayTuQuanTri.length === 0,
    thayTuQuanTri.length ? thayTuQuanTri.join(", ") : "sạch",
  );

  // Trang công khai hiển thị đúng một số điện thoại và một email: thông tin
  // liên hệ của nhà trọ, lấy từ Cài đặt. Nhiều hơn một nghĩa là có số của
  // người khác lọt vào — nhiều khả năng là khách thuê.
  const soDienThoai = [...new Set(html.match(/\b0\d{9,10}\b/g) ?? [])];
  ghi(
    "Chỉ có số điện thoại liên hệ của nhà trọ",
    soDienThoai.length <= 1,
    soDienThoai.length ? `${soDienThoai.length} số: ${soDienThoai.slice(0, 4).join(", ")}` : "không có số nào",
    soDienThoai.length > 1,
  );

  const email = [...new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) ?? [])];
  ghi(
    "Chỉ có email liên hệ của nhà trọ",
    email.length <= 1,
    email.length ? `${email.length}: ${email.slice(0, 4).join(", ")}` : "không có email nào",
    email.length > 1,
  );
}

/* ---------------------------------------------------------------- */

console.log("");
console.log(`Kiểm tra ${baseUrl}`);
console.log("");

const kếtNối = await kiemTraKetNoi();
if (!kếtNối) {
  console.log("  Không mở được địa chỉ. Kiểm tra lại địa chỉ hoặc bản deploy.");
  console.log("");
  process.exit(1);
}

await kiemTraKhuQuanTri();
await kiemTraRouteDungDuLieu();
await kiemTraTrangCongKhai();
await kiemTraTaiNguyen("/login");
await kiemTraTaiNguyen("/booking");

let hỏng = 0;
let cảnhBáo = 0;

for (const { muc, dat, chiTiet, nghiemTrong } of ketQua) {
  if (dat) {
    console.log(`  [ĐẠT ]  ${muc}  (${chiTiet})`);
  } else if (nghiemTrong) {
    hỏng += 1;
    console.log(`  [HỎNG]  ${muc}  (${chiTiet})`);
  } else {
    cảnhBáo += 1;
    console.log(`  [XEM ]  ${muc}  (${chiTiet})`);
  }
}

console.log("");
if (hỏng > 0) {
  console.log(`  ${hỏng} mục HỎNG. Đừng giao bản này cho người dùng cho tới khi sửa xong.`);
  console.log("  Xem mục 7 của docs/DEPLOY-CLOUDFLARE.md.");
  console.log("");
  process.exit(1);
}

console.log(`  Tất cả ${ketQua.length} mục đều đạt${cảnhBáo ? `, ${cảnhBáo} mục cần xem lại` : ""}.`);
console.log("");
console.log("  Còn hai việc phải làm bằng mắt, lệnh này không thay được:");
console.log("    - Đăng nhập thử bằng tài khoản thật, mở một biểu mẫu để chắc client chạy.");
console.log("    - Mở /booking bằng cửa sổ ẩn danh, đọc xem có tên người thuê nào không.");
console.log("");
