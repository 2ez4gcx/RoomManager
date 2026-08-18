/**
 * Kiểm thử chế độ server (`scripts/chay-server.mjs`).
 *
 * Bộ kiểm thử chính chạy worker trực tiếp trong Miniflare nên không thấy được
 * tầng phục vụ tệp tĩnh — và đúng chỗ đó từng có lỗi chặn bàn giao: mọi trang
 * trả 200 trong khi 100% CSS/JS/font đều 404, giao diện trần trụi và client
 * không hydrate. Bài kiểm thử này khởi động server thật rồi tải asset thật.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const goc = fileURLToPath(new URL("..", import.meta.url));
const CONG = 3987;
const goc_url = `http://127.0.0.1:${CONG}`;

let tienTrinh;

/**
 * Cơ sở dữ liệu dùng một lần, nằm ngoài dự án.
 *
 * TUYỆT ĐỐI không trỏ vào `.wrangler/state/server` — đó là số liệu thật của
 * người dùng, và bài kiểm thử này kết thúc bằng việc xóa thư mục.
 */
let thuMucDuLieu;

before(async () => {
  thuMucDuLieu = await mkdtemp(path.join(tmpdir(), "roommanager-test-"));
  tienTrinh = spawn(
    process.execPath,
    [
      path.join(goc, "scripts", "chay-server.mjs"),
      "--cong",
      String(CONG),
      "--du-lieu",
      thuMucDuLieu,
    ],
    { cwd: goc, stdio: "ignore" },
  );

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${goc_url}/login`);
      if (res.status === 200) return;
    } catch {
      // Chưa lên, thử lại.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("chay-server.mjs không khởi động được trong 60 giây");
});

after(async () => {
  tienTrinh?.kill();
  await new Promise((r) => setTimeout(r, 1500));
  await rm(thuMucDuLieu, { recursive: true, force: true });
});

/** Bóc mọi đường dẫn tĩnh mà trang khai báo. */
function bocTaiNguyen(html) {
  return [...new Set([...html.matchAll(/["'(](\/(?:_next|favicon|og)[^"')\\\s]*)/g)].map((m) => m[1]))];
}

test("mọi tài nguyên tĩnh của trang đăng nhập đều tải được", async () => {
  const html = await (await fetch(`${goc_url}/login`)).text();
  const taiNguyen = bocTaiNguyen(html);
  assert.ok(taiNguyen.length > 5, `trang chỉ khai báo ${taiNguyen.length} tài nguyên, bất thường`);

  const hong = [];
  for (const dd of taiNguyen) {
    const res = await fetch(goc_url + dd);
    if (res.status !== 200) hong.push(`${dd} -> ${res.status}`);
  }
  assert.deepEqual(hong, [], "tài nguyên tĩnh phải tải được, không thì giao diện vỡ");
});

test("tệp CSS và JavaScript được trả đúng kiểu nội dung", async () => {
  // Trình duyệt từ chối stylesheet gửi kèm content-type sai, nên 200 thôi
  // chưa đủ.
  const html = await (await fetch(`${goc_url}/login`)).text();
  const css = bocTaiNguyen(html).find((d) => d.endsWith(".css"));
  const js = bocTaiNguyen(html).find((d) => d.endsWith(".js"));
  assert.ok(css && js, "trang phải khai báo cả CSS lẫn JS");

  const resCss = await fetch(goc_url + css);
  assert.match(resCss.headers.get("content-type") ?? "", /^text\/css/);
  assert.ok((await resCss.text()).length > 100, "tệp CSS không được rỗng");

  const resJs = await fetch(goc_url + js);
  assert.match(resJs.headers.get("content-type") ?? "", /javascript/);
});

test("không đọc được tệp ngoài thư mục dist/client", async () => {
  for (const duongDan of [
    "/_next/../../package.json",
    "/%2e%2e/%2e%2e/package.json",
    "/_next/static/../../../db/seed.ts",
  ]) {
    const res = await fetch(goc_url + duongDan, { redirect: "manual" });
    assert.notEqual(res.status, 200, `${duongDan} không được trả về nội dung`);
  }
});

test("nhóm route dựng dữ liệu bị khóa ở chế độ server", async () => {
  // Bản build production không có ALLOW_DEV_SETUP. Đây là điều kiện để mở
  // server ra mạng nội bộ mà không ai xóa được cơ sở dữ liệu.
  const res = await fetch(`${goc_url}/api/dev/status`);
  assert.equal(res.status, 403);
});
