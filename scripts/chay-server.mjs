/**
 * Chạy RoomManager như một server thật trên máy này.
 *
 * Khác `npm run dev` ở chỗ quan trọng nhất: đây là **bản build production**,
 * nên `import.meta.env.DEV` là false và nhóm route `/api/dev/` bị khóa. Bản
 * dev mở nhóm route đó, mà mở server ra mạng nội bộ với nhóm route đó đang mở
 * thì bất kỳ ai trong cùng wifi cũng xóa sạch được cơ sở dữ liệu, không cần
 * đăng nhập. Đừng bao giờ dùng `npm run dev` làm server.
 *
 * Chạy trên Miniflare 4 — đúng runtime mà bộ kiểm thử đang chạy — chứ
 * không qua CLI wrangler. Lý do: wrangler đi kèm dự án có workerd cũ hơn bản
 * build và tự sập, còn bản wrangler mới hơn lại kéo theo miniflare 5 alpha làm
 * vỡ toàn bộ bộ kiểm thử. Gọi thẳng Miniflare tránh được cả hai.
 *
 *   node scripts/chay-server.mjs                 chạy server
 *   node scripts/chay-server.mjs --khoi-tao      tạo cơ sở dữ liệu trống và chủ nhà đầu tiên
 *   node scripts/chay-server.mjs --khoi-tao --xoa-du-lieu-cu
 *                                                như trên, kể cả khi đã có dữ liệu
 *                                                (sao lưu trước rồi mới xóa)
 *   node scripts/chay-server.mjs --dat-lai-mat-khau
 *                                                đặt lại mật khẩu một tài khoản khi
 *                                                không còn ai đăng nhập được
 *   node scripts/chay-server.mjs --cong 8080     đổi cổng
 *   node scripts/chay-server.mjs --chi-may-nay   chỉ nhận kết nối từ chính máy này,
 *                                                không mở ra mạng nội bộ
 *   node scripts/chay-server.mjs --sau-proxy     server đứng sau một reverse proxy có
 *                                                HTTPS (Caddy, nginx, cloudflared): tin
 *                                                các header X-Forwarded-* của proxy đó,
 *                                                và chỉ nhận kết nối từ chính máy này
 *   node scripts/chay-server.mjs --du-lieu <thư mục>   đổi nơi chứa dữ liệu
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { cp, readdir, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const goc = fileURLToPath(new URL("..", import.meta.url));
const thuMucBuild = path.join(goc, "dist", "server");
const thuMucClient = path.join(goc, "dist", "client");

/**
 * Cơ sở dữ liệu của chế độ server nằm riêng, không dùng chung với
 * `npm run dev`. Dev nạp dữ liệu mẫu và xóa sạch theo yêu cầu; trộn hai thứ là
 * sớm muộn cũng có ngày `reset-data.bat` xóa mất số liệu thật.
 *
 * ĐÂY LÀ THƯ MỤC CẦN SAO LƯU.
 */
const thuMucDuLieuMacDinh = path.join(goc, ".wrangler", "state", "server");

const thamSo = process.argv.slice(2);
const khoiTao = thamSo.includes("--khoi-tao");
const datLaiMatKhau = thamSo.includes("--dat-lai-mat-khau");
const chiMayNay = thamSo.includes("--chi-may-nay");
const sauProxy = thamSo.includes("--sau-proxy");

/**
 * Token mở nhóm route `/api/dev/` cho các bước khởi tạo/cập nhật chạy TRONG
 * tiến trình này. Sinh mới mỗi lần chạy và không in ra đâu cả.
 */
const tokenDev = randomBytes(24).toString("hex");

/** Gọi một route `/api/dev/` qua Miniflare không mở cổng, kèm token. */
function goiDev(mf, duongDan, init = {}) {
  return mf.dispatchFetch(`http://server${duongDan}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-dev-setup-token": tokenDev },
  });
}

/** Thân yêu cầu lớn nhất được nhận. Biểu mẫu của ứng dụng chỉ vài KB. */
const KICH_THUOC_THAN_TOI_DA = 2 * 1024 * 1024;
const cong = Number(thamSo[thamSo.indexOf("--cong") + 1]) || 3000;

/** Đọc `--ten gia-tri`. Cho phép chạy không cần gõ tay, để kiểm thử được. */
function thamSoChuoi(ten) {
  const i = thamSo.indexOf(`--${ten}`);
  return i >= 0 ? thamSo[i + 1] : undefined;
}

/**
 * `--du-lieu` cho phép trỏ sang thư mục khác. Bài kiểm thử dùng nó để có cơ sở
 * dữ liệu dùng một lần rồi xóa — không có tham số này thì bài kiểm thử buộc
 * phải xóa thư mục mặc định, tức là xóa số liệu thật của người dùng.
 */
const thuMucDuLieu = thamSoChuoi("du-lieu")
  ? path.resolve(thamSoChuoi("du-lieu"))
  : thuMucDuLieuMacDinh;

const KIEU_NOI_DUNG = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
]);

/**
 * Tìm tệp tĩnh trong `dist/client`, trả `null` nếu không có.
 *
 * Tầng này phải chạy TRƯỚC worker, giống hệt cách Cloudflare làm: Workers
 * Assets chặn `/_next/*` trước khi worker được gọi. Đặt nó vào binding ASSETS
 * là sai — đã thử và đo được: worker không hề gọi ASSETS cho `/_next/*`, nên
 * mọi CSS/JS/font đều 404 trong khi HTML vẫn 200. Trang trả về "thành công"
 * mà giao diện trần trụi, client không hydrate, nút bấm không chạy.
 */
async function timTepTinh(duongDanRaw) {
  const duongDan = decodeURIComponent(duongDanRaw);

  // Chặn traversal: ghép xong phải vẫn nằm trong dist/client.
  const tep = path.resolve(thuMucClient, "." + duongDan);
  if (tep !== thuMucClient && !tep.startsWith(thuMucClient + path.sep)) return null;

  try {
    const thongTin = await stat(tep);
    if (!thongTin.isFile()) return null;

    return {
      noiDung: await readFile(tep),
      kieu: KIEU_NOI_DUNG.get(path.extname(tep).toLowerCase()) ?? "application/octet-stream",
      // Tệp trong /_next/static/ có mã băm trong tên nên đổi nội dung là đổi
      // tên; cache vĩnh viễn được. Còn lại không cache, để sửa xong tải lại là
      // thấy ngay.
      cache: duongDan.startsWith("/_next/static/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
  } catch {
    return null;
  }
}

/** Bản build dùng dynamic import nên phải liệt kê module thủ công. */
async function nạpModule() {
  const entries = await readdir(thuMucBuild, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
    .map((e) => path.relative(thuMucBuild, path.join(e.parentPath, e.name)))
    .sort((a, b) => (a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b)))
    .map((f) => ({ type: "ESModule", path: path.join(thuMucBuild, f) }));
}

function diaChiLan() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
}

/**
 * `bindings` để rỗng là chủ ý: không có `ALLOW_DEV_SETUP`, nên nhóm route
 * `/api/dev/` bị khóa kể cả khi mở server ra mạng nội bộ.
 *
 * Chế độ khởi tạo bật biến đó lên, nhưng khi ấy Miniflare KHÔNG mở cổng mạng —
 * mọi lời gọi đi qua `dispatchFetch` trong tiến trình, không ai ngoài máy này
 * chạm tới được.
 */
async function dựngWorker({ moCong }) {
  await mkdir(thuMucDuLieu, { recursive: true });
  const mf = new Miniflare({
    modulesRoot: thuMucBuild,
    modules: await nạpModule(),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "room-manager" },
    d1Persist: thuMucDuLieu,
    bindings: moCong ? {} : { ALLOW_DEV_SETUP: "true", DEV_SETUP_TOKEN: tokenDev },
    // Miniflare không tự mở cổng: cổng do máy chủ HTTP bên dưới giữ, để tệp
    // tĩnh được phục vụ trước khi worker được gọi.
    serviceBindings: { ASSETS: () => new Response("Not found", { status: 404 }) },
  });
  await mf.ready;
  return mf;
}

/**
 * Số tài khoản đang có trong cơ sở dữ liệu của chế độ server. Trả 0 khi chưa
 * có bảng nào — tức là chưa từng khởi tạo.
 */
async function demTaiKhoan() {
  const mf = await dựngWorker({ moCong: false });
  try {
    const db = await mf.getD1Database("DB");
    const dong = await db.prepare("SELECT count(*) AS n FROM users").first();
    return Number(dong?.n ?? 0);
  } catch {
    return 0;
  } finally {
    await mf.dispose();
  }
}

/**
 * Chép nguyên thư mục dữ liệu sang một thư mục bên cạnh, trả về đường dẫn.
 *
 * Gọi khi KHÔNG có Miniflare nào đang mở thư mục đó, để bản chép là một ảnh
 * chụp nhất quán của file SQLite.
 */
async function saoLuu(lyDo) {
  const dau = new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-");
  const dich = `${thuMucDuLieu}-sao-luu-${dau}-${lyDo}`;
  await cp(thuMucDuLieu, dich, { recursive: true });
  return dich;
}

const tepDauMigration = path.join(thuMucDuLieu, "migration-da-ap.txt");

/** Dấu vân tay của bộ migration trong mã nguồn hiện tại. */
async function dauVanTayMigration() {
  const thuMuc = path.join(goc, "drizzle");
  const bam = createHash("sha256");
  for (const ten of (await readdir(thuMuc)).filter((t) => t.endsWith(".sql")).sort()) {
    bam.update(ten);
    bam.update(await readFile(path.join(thuMuc, ten)));
  }
  return bam.digest("hex");
}

/**
 * Áp migration mới lên dữ liệu đang có, trước khi mở cổng.
 *
 * Không có bước này thì cập nhật mã nguồn có đổi cấu trúc bảng sẽ chạy trên cơ
 * sở dữ liệu cũ và báo lỗi SQL ngay trên số liệu thật: nhóm route `/api/dev/`
 * — nơi duy nhất gọi migration — bị khóa ở chế độ server.
 *
 * Chỉ chạy khi bộ migration khác lần trước (so dấu vân tay ghi trong thư mục
 * dữ liệu), và sao lưu trước nếu đã có dữ liệu. Migration chạy trong một
 * Miniflare không mở cổng, cùng cách với `--khoi-tao`.
 */
async function apMigrationNeuCan() {
  const hienTai = await dauVanTayMigration();
  const daAp = await readFile(tepDauMigration, "utf8").catch(() => "");
  if (daAp.trim() === hienTai) return;

  if ((await demTaiKhoan()) > 0) {
    const banSao = await saoLuu("truoc-cap-nhat");
    console.log("");
    console.log("  Mã nguồn có thay đổi cấu trúc dữ liệu. Đã sao lưu trước khi cập nhật:");
    console.log(`    ${banSao}`);
  }

  const mf = await dựngWorker({ moCong: false });
  try {
    const kq = await goiDev(mf, "/api/dev/setup?migrate=true", { method: "POST" });
    if (!kq.ok) throw new Error(`Cập nhật cấu trúc dữ liệu thất bại: ${await kq.text()}`);
  } finally {
    await mf.dispose();
  }
  await writeFile(tepDauMigration, hienTai);
}

/* ---------------------------------------------------------------- */

if (datLaiMatKhau) {
  // Cứu hộ khi chủ nhà duy nhất quên mật khẩu: không ai cấp được link đặt lại,
  // nên phải sửa thẳng cơ sở dữ liệu. Làm ngay trong tiến trình này, trên đúng
  // file SQLite mà server dùng — lệnh `wrangler d1 execute --local` mở một file
  // khác và báo thành công trong khi không đổi gì.
  const sanCo = { email: thamSoChuoi("email"), matKhau: thamSoChuoi("mat-khau") };
  const hỏi =
    sanCo.email && sanCo.matKhau
      ? null
      : createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("  Đặt lại mật khẩu cho một tài khoản của chế độ server.");
  console.log("  Tắt server (chay-server.bat) trước khi làm bước này.");
  console.log(`  Thư mục dữ liệu: ${thuMucDuLieu}`);
  console.log("");

  const email = (sanCo.email ?? (await hỏi.question("  Email hoặc tên đăng nhập: ")))
    .trim()
    .toLowerCase();
  const matKhau = sanCo.matKhau ?? (await hỏi.question("  Mật khẩu mới (ít nhất 8 ký tự): "));
  hỏi?.close();

  if (matKhau.length < 8) {
    console.error("\n  [LỖI] Mật khẩu phải có ít nhất 8 ký tự.\n");
    process.exit(1);
  }

  // Dùng chung hàm băm với máy chủ để định dạng chắc chắn khớp.
  const { hashPassword } = await import("../db/password-hash.ts");
  const mf = await dựngWorker({ moCong: false });
  try {
    const db = await mf.getD1Database("DB");
    const taiKhoan = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!taiKhoan) throw new Error(`Không có tài khoản nào tên "${email}".`);

    await db
      .prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() * 1000 WHERE id = ?")
      .bind(await hashPassword(matKhau), taiKhoan.id)
      .run();
    // Thu hồi mọi phiên cũ: nếu mật khẩu bị lộ thì người kia cũng bị đẩy ra.
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(taiKhoan.id).run();

    const thu = await mf.dispatchFetch("http://server/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
      body: JSON.stringify({ email, password: matKhau }),
    });
    // Tài khoản bật xác thực hai bước sẽ được hỏi mã chứ không vào thẳng; cả
    // hai đều nghĩa là mật khẩu mới đã được nhận.
    if (thu.status !== 200) throw new Error("Đã ghi nhưng đăng nhập thử không được.");

    console.log("");
    console.log(`  Xong. Đã đặt lại mật khẩu cho ${email} và đăng xuất mọi thiết bị cũ.`);
    console.log("  Chạy lại server rồi đổi mật khẩu ở trang Cài đặt.");
    console.log("");
  } catch (loi) {
    console.error(`\n  [LỖI] ${loi.message}\n`);
    process.exitCode = 1;
  } finally {
    await mf.dispose();
  }
} else if (khoiTao) khoiTaoBlock: {
  const sanCo = {
    email: thamSoChuoi("email"),
    hoTen: thamSoChuoi("ho-ten"),
    matKhau: thamSoChuoi("mat-khau"),
    dienThoai: thamSoChuoi("dien-thoai") ?? "",
    boQuaXacNhan: thamSo.includes("--toi-dong-y-xoa-sach"),
  };
  const đủThamSố = sanCo.email && sanCo.hoTen && sanCo.matKhau && sanCo.boQuaXacNhan;

  // Đã có tài khoản tức là đã có dữ liệu thật. Chạy nhầm file khởi tạo lần hai
  // không được phép xóa nó chỉ bằng một câu xác nhận gõ quen tay.
  const soTaiKhoan = await demTaiKhoan();
  if (soTaiKhoan > 0 && !thamSo.includes("--xoa-du-lieu-cu")) {
    console.log("");
    console.log(`  [DỪNG] Cơ sở dữ liệu này đã có ${soTaiKhoan} tài khoản — tức là đã có dữ liệu.`);
    console.log("  Khởi tạo sẽ XÓA SẠCH toàn bộ, nên không tự làm.");
    console.log("");
    console.log(`  Thư mục dữ liệu: ${thuMucDuLieu}`);
    console.log("");
    console.log("  Chỉ cần chạy server:  chay-server.bat");
    console.log("  Nếu thật sự muốn xóa hết và làm lại từ đầu:");
    console.log("    node scripts/chay-server.mjs --khoi-tao --xoa-du-lieu-cu");
    console.log("  (lệnh đó sao lưu dữ liệu cũ sang thư mục bên cạnh rồi mới xóa)");
    console.log("");
    // Không gọi process.exit ở đây: thoát đột ngột ngay sau khi Miniflare vừa
    // đóng làm tiến trình sập trên Windows thay vì trả mã lỗi 1.
    process.exitCode = 1;
    break khoiTaoBlock;
  }

  const hỏi = đủThamSố
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  if (soTaiKhoan > 0) {
    console.log("  Bước này XÓA SẠCH cơ sở dữ liệu của chế độ server rồi tạo tài khoản");
    console.log("  chủ nhà đầu tiên. Dữ liệu cũ được sao lưu sang thư mục bên cạnh trước.");
  } else {
    console.log("  Bước này tạo cơ sở dữ liệu trống cho chế độ server và tài khoản chủ");
    console.log("  nhà đầu tiên.");
  }
  console.log("");
  console.log(`  Thư mục dữ liệu: ${thuMucDuLieu}`);
  console.log("");

  if (hỏi) {
    const xacNhan = await hỏi.question("  Gõ 'dung that' rồi Enter để xác nhận: ");
    if (xacNhan.trim() !== "dung that") {
      console.log("\n  Đã hủy, không thay đổi gì.\n");
      hỏi.close();
      process.exit(0);
    }
  }

  const email = (sanCo.email ?? (await hỏi.question("  Email hoặc tên đăng nhập: "))).trim();
  const hoTen = (sanCo.hoTen ?? (await hỏi.question("  Họ tên: "))).trim();
  const matKhau = sanCo.matKhau ?? (await hỏi.question("  Mật khẩu (ít nhất 8 ký tự): "));
  const dienThoai = (
    sanCo.dienThoai || (hỏi ? await hỏi.question("  Số điện thoại (bỏ trống cũng được): ") : "")
  ).trim();
  hỏi?.close();

  if (soTaiKhoan > 0) {
    const banSao = await saoLuu("truoc-khi-xoa");
    console.log("");
    console.log(`  Đã sao lưu dữ liệu cũ: ${banSao}`);
  }

  const mf = await dựngWorker({ moCong: false });
  try {
    const xoa = await goiDev(mf, "/api/dev/setup?empty=true", { method: "POST" });
    if (!xoa.ok) throw new Error(`Dựng bảng thất bại: ${await xoa.text()}`);

    const tao = await goiDev(mf, "/api/dev/create-owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, fullName: hoTen, password: matKhau, phone: dienThoai }),
    });
    const kq = await tao.json();
    if (tao.status !== 201) throw new Error(kq.error ?? JSON.stringify(kq));

    // Đăng nhập thử ngay: bắt được trường hợp mật khẩu bị đổi trên đường đi,
    // thay vì để người dùng phát hiện lúc không vào được mà chẳng hiểu vì sao.
    const thu = await mf.dispatchFetch("http://server/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
      body: JSON.stringify({ email, password: matKhau }),
    });
    if (thu.status !== 200) throw new Error("Tạo xong nhưng đăng nhập thử không được.");

    // `setup?empty=true` đã áp đủ migration; ghi dấu để lần chạy server đầu
    // tiên không sao lưu và áp lại vô ích.
    await writeFile(tepDauMigration, await dauVanTayMigration());

    console.log("");
    console.log(`  Xong. Tài khoản chủ nhà: ${kq.user.email}`);
    console.log("  Đã thử đăng nhập bằng chính mật khẩu vừa đặt: được.");
    console.log("");
    console.log("  Chạy server bằng:  node scripts/chay-server.mjs");
    console.log("");
  } catch (loi) {
    console.error(`\n  [LỖI] ${loi.message}\n`);
    process.exitCode = 1;
  } finally {
    await mf.dispose();
  }
} else {
  await apMigrationNeuCan();
  const mf = await dựngWorker({ moCong: true });

  /**
   * Máy chủ HTTP đứng trước worker: tệp tĩnh trước, còn lại chuyển tiếp vào
   * Miniflare. Cùng thứ tự mà Cloudflare dùng.
   */
  const mayChu = createServer(async (req, res) => {
    try {
      const duongDan = req.url.split("?")[0];
      const tep = req.method === "GET" || req.method === "HEAD" ? await timTepTinh(duongDan) : null;

      if (tep) {
        res.writeHead(200, {
          "content-type": tep.kieu,
          "cache-control": tep.cache,
          "content-length": tep.noiDung.length,
        });
        res.end(req.method === "HEAD" ? undefined : tep.noiDung);
        return;
      }

      const than =
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : Buffer.concat(await new Promise((ok, loi) => {
              const cac = [];
              let tong = 0;
              req.on("data", (c) => {
                // Không giới hạn thì một yêu cầu khổng lồ từ bất kỳ máy nào
                // trong wifi cũng làm đầy bộ nhớ của server.
                tong += c.length;
                if (tong > KICH_THUOC_THAN_TOI_DA) {
                  loi(Object.assign(new Error("Thân yêu cầu quá lớn."), { maHttp: 413 }));
                  req.destroy();
                  return;
                }
                cac.push(c);
              });
              req.on("end", () => ok(cac));
              req.on("error", loi);
            }));

      const dau = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => dau.append(k, x));
        else if (v !== undefined) dau.set(k, v);
      }
      // Giới hạn số lần đăng nhập sai đếm theo cf-connecting-ip. Không đặt thì
      // mọi máy trong wifi dùng chung một bộ đếm: một người gõ sai 5 lần là
      // khóa cả nhà. Ghi đè kể cả khi client tự gửi, vì header do client gửi
      // thì client tự đổi được để lách.
      let ip = (req.socket.remoteAddress ?? "127.0.0.1").replace(/^::ffff:/, "");
      let giaoThuc = "http";
      let tenMay = req.headers.host ?? "localhost";

      if (sauProxy) {
        // Chỉ tin các header này vì chế độ --sau-proxy chỉ nhận kết nối từ
        // chính máy này, tức là từ proxy. Proxy NỐI THÊM địa chỉ của người gọi
        // vào cuối X-Forwarded-For, nên phần tử cuối là thứ duy nhất proxy
        // bảo đảm; các phần tử trước đó do người gọi tự gửi và giả được.
        const chuoi = String(req.headers["x-forwarded-for"] ?? "");
        const cuoi = chuoi.split(",").at(-1)?.trim();
        if (cuoi) ip = cuoi;
        if (String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https") {
          giaoThuc = "https";
        }
        const tenChuyenTiep = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
        if (tenChuyenTiep) {
          tenMay = tenChuyenTiep;
          dau.set("host", tenChuyenTiep);
        }
      }
      dau.set("cf-connecting-ip", ip);

      // Giao thức đúng là điều kiện để cookie phiên mang cờ Secure: route đăng
      // nhập đặt cờ đó khi URL của yêu cầu là https.
      const phanHoi = await mf.dispatchFetch(`${giaoThuc}://${tenMay}${req.url}`, {
        method: req.method,
        headers: dau,
        body: than,
        redirect: "manual",
      });

      const dauRa = {};
      for (const [k, v] of phanHoi.headers) {
        if (k.toLowerCase() !== "set-cookie") dauRa[k] = v;
      }
      const cookie = phanHoi.headers.getSetCookie?.() ?? [];
      res.writeHead(phanHoi.status, cookie.length ? { ...dauRa, "set-cookie": cookie } : dauRa);
      res.end(Buffer.from(await phanHoi.arrayBuffer()));
    } catch (loi) {
      // Chi tiết lỗi ghi ra cửa sổ server cho người vận hành; người gọi chỉ
      // nhận một câu chung, không lộ đường dẫn hay cấu trúc bên trong.
      const ma = loi.maHttp ?? 500;
      if (ma === 500) console.error("  [LỖI]", loi);
      if (!res.headersSent) res.writeHead(ma, { "content-type": "text/plain; charset=utf-8" });
      res.end(ma === 413 ? "Yêu cầu quá lớn." : "Lỗi máy chủ. Xem cửa sổ server để biết chi tiết.");
    }
  });

  const chiNoiBo = chiMayNay || sauProxy;
  await new Promise((ok) => mayChu.listen(cong, chiNoiBo ? "127.0.0.1" : "0.0.0.0", ok));

  /**
   * Rà nhắc nợ mỗi ngày một lần.
   *
   * Bản deploy trên Cloudflare có Cron Trigger lo việc này (`triggers.crons`
   * trong vite.config.ts). Miniflare không tự chạy cron, nên chế độ server ở
   * máy phải tự hẹn giờ — không có thì tính năng nhắc nợ im lặng ngừng hoạt
   * động mà không ai biết, chỉ còn nút "Rà lại ngay" bấm tay.
   *
   * Kiểm mỗi 15 phút thay vì hẹn đúng 08:00: máy tính để bàn hay bị ngủ hoặc
   * tắt qua đêm, hẹn một mốc cố định là lỡ luôn ngày đó.
   */
  const GIO_RA = 8;
  let ngayDaRa = null;

  async function raNhacNoNeuDenGio() {
    const now = new Date();
    const homNay = now.toLocaleDateString("sv-SE");
    if (ngayDaRa === homNay || now.getHours() < GIO_RA) return;

    ngayDaRa = homNay;
    const gio = now.toLocaleTimeString("vi-VN");
    try {
      // Gọi trong tiến trình. Đường HTTP `/cdn-cgi/handler/scheduled` cần bật
      // `unsafeTriggerHandlers`, mà bật thì bất kỳ ai trong wifi cũng kích
      // được handler ghi dữ liệu, không cần đăng nhập.
      const worker = await mf.getWorker();
      const kq = await worker.scheduled({ scheduledTime: Date.now(), cron: "0 1 * * *" });
      console.log(
        kq.outcome === "ok"
          ? `  [${gio}] Đã rà nhắc nợ cho ngày ${homNay}.`
          : `  [${gio}] Rà nhắc nợ không xong (${kq.outcome}). Vào trang Nhắc nợ bấm "Rà lại ngay".`,
      );
    } catch (loi) {
      console.log(`  [${gio}] Rà nhắc nợ thất bại: ${loi.message}`);
      // Thử lại ở lần kiểm sau thay vì bỏ luôn cả ngày.
      ngayDaRa = null;
    }
  }

  await raNhacNoNeuDenGio();
  const hẹnGiờ = setInterval(raNhacNoNeuDenGio, 15 * 60 * 1000);

  console.log("");
  console.log("  ==========================================");
  console.log("   RoomManager đang chạy");
  console.log("  ==========================================");
  console.log("");
  console.log(`  Trên máy này:     http://localhost:${cong}`);
  for (const dc of chiNoiBo ? [] : diaChiLan()) {
    console.log(`  Máy khác/điện thoại: http://${dc}:${cong}`);
  }
  console.log("");
  if (sauProxy) {
    console.log("  Chế độ sau proxy: tin X-Forwarded-For/-Proto/-Host từ proxy trên máy này.");
    console.log("  Trỏ proxy HTTPS của bạn vào địa chỉ trên; đừng mở cổng này ra ngoài.");
  }
  console.log("  Nhóm route /api/dev/ đã khóa (bản build production).");
  console.log(`  Rà nhắc nợ tự động: mỗi ngày sau ${GIO_RA} giờ sáng.`);
  console.log(`  Dữ liệu: ${thuMucDuLieu}`);
  console.log("");
  console.log("  Kiểm tra an toàn từ cửa sổ khác:");
  console.log(`    npm run kiem-tra-deploy -- http://localhost:${cong}`);
  console.log("");
  console.log("  Ctrl+C để dừng.");
  console.log("");

  const dừng = async () => {
    console.log("\n  Đang dừng...");
    // Dọn hẹn giờ trước khi dispose: nó bắn đúng lúc đang tắt là gọi vào một
    // Miniflare đã đóng, ném lỗi không ai bắt.
    clearInterval(hẹnGiờ);
    mayChu.close();
    await mf.dispose();
    process.exit(0);
  };
  process.on("SIGINT", dừng);
  process.on("SIGTERM", dừng);
}
