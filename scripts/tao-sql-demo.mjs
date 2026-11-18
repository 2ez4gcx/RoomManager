/**
 * Sinh file SQL chứa dữ liệu mẫu, để nạp lên một D1 thật làm bản demo.
 *
 * Vì sao cần: route `/api/dev/setup` — thứ nạp dữ liệu mẫu ở máy — bị khóa
 * trên môi trường thật, cố ý, vì nó xóa sạch cơ sở dữ liệu. Muốn có một bản
 * demo cho khách xem thì phải đưa dữ liệu vào bằng đường khác, và đường đó
 * không được là "mở tạm route xóa dữ liệu ra Internet".
 *
 * Cách làm: dựng cơ sở dữ liệu mẫu trong một thư mục tạm bằng chính mã của
 * ứng dụng, rồi đọc file SQLite đó và viết ra INSERT. Dữ liệu sinh ra giống
 * hệt thứ `start.bat` cho thấy.
 *
 *   node scripts/tao-sql-demo.mjs [tên-file.sql]
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { randomBytes } from "node:crypto";

const goc = fileURLToPath(new URL("..", import.meta.url));
const thuMucBuild = path.join(goc, "dist", "server");
const dauRa = path.resolve(process.argv[2] ?? "demo-du-lieu-mau.sql");

/**
 * Bảng nội bộ của D1, không thuộc dữ liệu ứng dụng.
 *
 * Bỏ sót là hỏng ngay chứ không phải rủi ro xa: D1 từ chối cả `DELETE` lẫn
 * `INSERT` vào bảng `_cf_*` của nó với lỗi SQLITE_AUTH, nên file SQL sinh ra
 * sẽ dừng ngay câu lệnh đầu tiên. Lọc theo tiền tố thay vì liệt kê từng tên,
 * để D1 thêm bảng nội bộ mới cũng không phá.
 */
function laBangNoiBo(ten) {
  return (
    ten.startsWith("_cf_") ||
    ten.startsWith("sqlite_") ||
    ten === "d1_migrations" ||
    ten === "__drizzle_migrations"
  );
}

async function nạpModule() {
  const entries = await readdir(thuMucBuild, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
    .map((e) => path.relative(thuMucBuild, path.join(e.parentPath, e.name)))
    .sort((a, b) => (a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b)))
    .map((f) => ({ type: "ESModule", path: path.join(thuMucBuild, f) }));
}

/** Escape theo chuẩn SQL: nháy đơn nhân đôi, blob thành X'..'. */
function giaTri(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) {
    return `X'${[...v].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(v).replaceAll("'", "''")}'`;
}

const thuMucTam = await mkdtemp(path.join(tmpdir(), "roommanager-demo-"));
// Route dựng dữ liệu cần cả công tắc lẫn token; sinh token riêng cho lần chạy này.
const tokenDev = randomBytes(24).toString("hex");

const mf = new Miniflare({
  modulesRoot: thuMucBuild,
  modules: await nạpModule(),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "room-manager" },
  d1Persist: thuMucTam,
  bindings: { ALLOW_DEV_SETUP: "true", DEV_SETUP_TOKEN: tokenDev },
  serviceBindings: { ASSETS: () => new Response("Not found", { status: 404 }) },
});

try {
  await mf.ready;
  const res = await mf.dispatchFetch("http://demo/api/dev/setup?reset=true", {
    method: "POST",
    headers: { "x-dev-setup-token": tokenDev },
  });
  const kq = await res.json();
  if (!res.ok || !kq.seeded) throw new Error(`Nạp dữ liệu mẫu thất bại: ${JSON.stringify(kq)}`);
  console.log(`  Đã dựng dữ liệu mẫu: ${JSON.stringify(kq.counts)}`);
  await mf.dispose();

  const thuMucD1 = path.join(thuMucTam, "miniflare-D1DatabaseObject");
  const tep = (await readdir(thuMucD1)).filter(
    (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
  );
  if (tep.length !== 1) throw new Error(`Mong đợi đúng 1 file sqlite, thấy ${tep.length}`);

  const db = new DatabaseSync(path.join(thuMucD1, tep[0]), { readOnly: true });
  const bang = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((n) => !laBangNoiBo(n));

  /**
   * Sắp bảng theo phụ thuộc khóa ngoại: cha trước, con sau.
   *
   * Thứ tự chữ cái thì hỏng ngay — `booking_requests` đứng đầu bảng chữ cái
   * nhưng tham chiếu tới `properties`, nên D1 từ chối với
   * SQLITE_CONSTRAINT_FOREIGNKEY ở dòng INSERT đầu tiên.
   */
  function sapTheoPhuThuoc(danhSach) {
    const phuThuoc = new Map(
      danhSach.map((ten) => [
        ten,
        new Set(
          db
            .prepare(`PRAGMA foreign_key_list("${ten}")`)
            .all()
            .map((r) => r.table)
            .filter((t) => t !== ten && danhSach.includes(t)),
        ),
      ]),
    );

    const xong = [];
    const daXong = new Set();
    while (xong.length < danhSach.length) {
      const sanSang = danhSach.filter(
        (t) => !daXong.has(t) && [...phuThuoc.get(t)].every((d) => daXong.has(d)),
      );
      if (sanSang.length === 0) {
        // Vòng tham chiếu: xếp nốt phần còn lại theo thứ tự cũ và để khóa ngoại
        // tự báo nếu thật sự có vấn đề, thay vì lặp vô hạn.
        for (const t of danhSach) {
          if (!daXong.has(t)) {
            xong.push(t);
            daXong.add(t);
          }
        }
        break;
      }
      for (const t of sanSang) {
        xong.push(t);
        daXong.add(t);
      }
    }
    return xong;
  }

  const theoThuTu = sapTheoPhuThuoc(bang);

  const dong = [
    "-- Dữ liệu mẫu RoomManager, sinh bằng scripts/tao-sql-demo.mjs",
    "-- CHỈ dùng cho bản demo. Tài khoản trong này có mật khẩu công khai",
    "-- trong mã nguồn, tuyệt đối không nạp vào cơ sở dữ liệu chứa số liệu thật.",
    "",
  ];
  // Xóa thì ngược lại: con trước, cha sau.
  for (const ten of [...theoThuTu].reverse()) {
    dong.push(`DELETE FROM "${ten}";`);
  }
  dong.push("");

  let tong = 0;
  for (const ten of theoThuTu) {
    const hang = db.prepare(`SELECT * FROM "${ten}"`).all();
    if (hang.length === 0) continue;
    dong.push(`-- ${ten}: ${hang.length} dòng`);
    const cot = Object.keys(hang[0]);
    for (const h of hang) {
      dong.push(
        `INSERT INTO "${ten}" (${cot.map((c) => `"${c}"`).join(", ")}) VALUES (${cot
          .map((c) => giaTri(h[c]))
          .join(", ")});`,
      );
    }
    dong.push("");
    tong += hang.length;
  }
  db.close();

  await writeFile(dauRa, dong.join("\n"), "utf8");
  console.log(`  Đã ghi ${dauRa}`);
  console.log(`  ${theoThuTu.length} bảng, ${tong} dòng`);
  console.log("");
  console.log("  Nạp lên D1 của bản demo:");
  console.log(`    npx wrangler d1 execute <TEN_DATABASE> --remote --file="${path.basename(dauRa)}"`);
  console.log("");
} finally {
  await rm(thuMucTam, { recursive: true, force: true });
}
