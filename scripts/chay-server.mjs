/**
 * Chạy RoomManager như một server thật trên máy này.
 *
 * Khác `npm run dev` ở chỗ quan trọng nhất: đây là **bản build production**,
 * nên `import.meta.env.DEV` là false và nhóm route `/api/dev/` bị khóa. Bản
 * dev mở nhóm route đó, mà mở server ra mạng nội bộ với nhóm route đó đang mở
 * thì bất kỳ ai trong cùng wifi cũng xóa sạch được cơ sở dữ liệu, không cần
 * đăng nhập. Đừng bao giờ dùng `npm run dev` làm server.
 *
 * Chạy trên Miniflare 4 — đúng runtime mà 132 bài kiểm thử đang chạy — chứ
 * không qua CLI wrangler. Lý do: wrangler đi kèm dự án có workerd cũ hơn bản
 * build và tự sập, còn bản wrangler mới hơn lại kéo theo miniflare 5 alpha làm
 * vỡ toàn bộ bộ kiểm thử. Gọi thẳng Miniflare tránh được cả hai.
 *
 *   node scripts/chay-server.mjs                 chạy server
 *   node scripts/chay-server.mjs --khoi-tao      xóa sạch và tạo chủ nhà đầu tiên
 *   node scripts/chay-server.mjs --cong 8080     đổi cổng
 */
import { readdir, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const goc = fileURLToPath(new URL("..", import.meta.url));
const thuMucBuild = path.join(goc, "dist", "server");

/**
 * Cơ sở dữ liệu của chế độ server nằm riêng, không dùng chung với
 * `npm run dev`. Dev nạp dữ liệu mẫu và xóa sạch theo yêu cầu; trộn hai thứ là
 * sớm muộn cũng có ngày `reset-data.bat` xóa mất số liệu thật.
 *
 * ĐÂY LÀ THƯ MỤC CẦN SAO LƯU.
 */
const thuMucDuLieu = path.join(goc, ".wrangler", "state", "server");

const thamSo = process.argv.slice(2);
const khoiTao = thamSo.includes("--khoi-tao");
const cong = Number(thamSo[thamSo.indexOf("--cong") + 1]) || 3000;

/** Đọc `--ten gia-tri`. Cho phép chạy không cần gõ tay, để kiểm thử được. */
function thamSoChuoi(ten) {
  const i = thamSo.indexOf(`--${ten}`);
  return i >= 0 ? thamSo[i + 1] : undefined;
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
    bindings: moCong ? {} : { ALLOW_DEV_SETUP: "true" },
    serviceBindings: { ASSETS: () => new Response("Not found", { status: 404 }) },
    ...(moCong ? { host: "0.0.0.0", port: cong } : {}),
  });
  await mf.ready;
  return mf;
}

/* ---------------------------------------------------------------- */

if (khoiTao) {
  const sanCo = {
    email: thamSoChuoi("email"),
    hoTen: thamSoChuoi("ho-ten"),
    matKhau: thamSoChuoi("mat-khau"),
    dienThoai: thamSoChuoi("dien-thoai") ?? "",
    boQuaXacNhan: thamSo.includes("--toi-dong-y-xoa-sach"),
  };
  const đủThamSố = sanCo.email && sanCo.hoTen && sanCo.matKhau && sanCo.boQuaXacNhan;

  const hỏi = đủThamSố
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("  Bước này XÓA SẠCH cơ sở dữ liệu của chế độ server rồi tạo tài khoản");
  console.log("  chủ nhà đầu tiên. Dữ liệu đã nhập sẽ mất, không hoàn tác được.");
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

  const mf = await dựngWorker({ moCong: false });
  try {
    const xoa = await mf.dispatchFetch("http://server/api/dev/setup?empty=true", { method: "POST" });
    if (!xoa.ok) throw new Error(`Dựng bảng thất bại: ${await xoa.text()}`);

    const tao = await mf.dispatchFetch("http://server/api/dev/create-owner", {
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
  const mf = await dựngWorker({ moCong: true });

  console.log("");
  console.log("  ==========================================");
  console.log("   RoomManager đang chạy");
  console.log("  ==========================================");
  console.log("");
  console.log(`  Trên máy này:     http://localhost:${cong}`);
  for (const dc of diaChiLan()) {
    console.log(`  Máy khác/điện thoại: http://${dc}:${cong}`);
  }
  console.log("");
  console.log("  Nhóm route /api/dev/ đã khóa (bản build production).");
  console.log(`  Dữ liệu: ${thuMucDuLieu}`);
  console.log("");
  console.log("  Kiểm tra an toàn từ cửa sổ khác:");
  console.log(`    npm run kiem-tra-deploy -- http://localhost:${cong}`);
  console.log("");
  console.log("  Ctrl+C để dừng.");
  console.log("");

  const dừng = async () => {
    console.log("\n  Đang dừng...");
    await mf.dispose();
    process.exit(0);
  };
  process.on("SIGINT", dừng);
  process.on("SIGTERM", dừng);
}
