/**
 * Kiểm thử kết xuất và nghiệp vụ phía máy chủ.
 *
 * Chạy bản build trong Miniflare (workerd thật + D1 thật) thay vì nạp bằng Node
 * thuần, vì worker có `import cloudflare:workers` mà Node không hiểu, và các
 * trang đã nối cơ sở dữ liệu cần binding `DB` thật mới kết xuất được.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const distServer = fileURLToPath(new URL("../dist/server", import.meta.url));

const OWNER_EMAIL = "quanly@hoangan.vn";
const OWNER_PASSWORD = "roommanager";

/**
 * Bản build dùng dynamic import nên Miniflare không tự dò được đồ thị module.
 * Liệt kê thủ công mọi file JS trong `dist/server`, đặt `index.js` lên đầu vì
 * đó là điểm vào.
 */
async function collectModules() {
  const entries = await readdir(distServer, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
    .map((entry) => path.relative(distServer, path.join(entry.parentPath, entry.name)))
    .sort((a, b) => (a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b)));

  return files.map((file) => ({ type: "ESModule", path: path.join(distServer, file) }));
}

function makeWorker(databaseName, bindings = {}) {
  return collectModules().then(
    (modules) =>
      new Miniflare({
        modulesRoot: distServer,
        modules,
        compatibilityDate: "2026-05-15",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: databaseName },
        bindings,
        serviceBindings: { ASSETS: () => new Response("Not found", { status: 404 }) },
      }),
  );
}

let mf;
/** Cookie phiên của chủ nhà, dùng lại cho mọi yêu cầu cần đăng nhập. */
let sessionCookie = "";

function authed(pathname, init = {}) {
  return mf.dispatchFetch(`http://localhost${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: sessionCookie },
    redirect: "manual",
  });
}

function anonymous(pathname, init = {}) {
  return mf.dispatchFetch(`http://localhost${pathname}`, { ...init, redirect: "manual" });
}

function json(pathname, body, method = "POST") {
  return authed(pathname, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  mf = await makeWorker("room-manager-test", { ALLOW_DEV_SETUP: "true" });

  const setup = await anonymous("/api/dev/setup", { method: "POST" });
  const payload = await setup.json();
  assert.equal(setup.status, 200, `dựng dữ liệu thất bại: ${JSON.stringify(payload)}`);
  assert.equal(payload.counts.rooms, 40);

  const login = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  assert.equal(login.status, 200, "đăng nhập bằng tài khoản mẫu thất bại");
  sessionCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(sessionCookie.startsWith("rm_session="), "không nhận được cookie phiên");
});

after(async () => {
  await mf?.dispose();
});

/* ------------------------------------------------------------------ */
/* Xác thực                                                           */
/* ------------------------------------------------------------------ */

test("khu quản trị chuyển hướng về trang đăng nhập khi chưa đăng nhập", async () => {
  for (const pathname of ["/", "/rooms", "/tenants", "/invoices", "/cashflow", "/bookings", "/settings"]) {
    const response = await anonymous(pathname);
    assert.equal(response.status, 307, `${pathname} phải chuyển hướng`);
    assert.match(response.headers.get("location") ?? "", /\/login$/, pathname);
  }
});

test("API riêng tư trả 401 khi chưa đăng nhập", async () => {
  for (const pathname of ["/api/rooms", "/api/tenants", "/api/bookings", "/api/ledger", "/api/settings", "/api/properties"]) {
    const response = await anonymous(pathname);
    assert.equal(response.status, 401, pathname);
  }
});

test("từ chối đăng nhập sai và không tiết lộ email có tồn tại hay không", async () => {
  const wrongPassword = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: "sai-mat-khau" }),
  });
  const unknownEmail = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "khong-ton-tai@example.com", password: OWNER_PASSWORD }),
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  // Cùng một thông điệp cho cả hai ca, nếu khác nhau là dò được tài khoản.
  assert.equal((await wrongPassword.json()).error, (await unknownEmail.json()).error);
});

test("cookie phiên là HttpOnly và SameSite", async () => {
  const login = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test("route dựng dữ liệu bị khóa khi không khai báo ALLOW_DEV_SETUP", async () => {
  // Bản build production không có biến này; route phải từ chối để không ai
  // xóa được cơ sở dữ liệu thật qua Internet.
  const locked = await makeWorker("room-manager-locked");
  try {
    const response = await locked.dispatchFetch("http://localhost/api/dev/setup?reset=true", {
      method: "POST",
    });
    assert.equal(response.status, 403);
  } finally {
    await locked.dispose();
  }
});

/* ------------------------------------------------------------------ */
/* Kết xuất trang                                                     */
/* ------------------------------------------------------------------ */

test("trang Tổng quan kết xuất số liệu lấy từ cơ sở dữ liệu", async () => {
  const response = await authed("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /RoomManager/);
  assert.match(html, /Tình trạng phòng/);
  assert.match(html, /40<!-- --> phòng/);
  assert.match(html, /Công suất lấp đầy/);
  // Tên người đăng nhập, không phải tên cứng trong mã.
  assert.match(html, /Trần Hoàng/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

for (const [pathname, expected] of [
  ["/rooms", "Nhà &amp; phòng"],
  ["/tenants", "Danh sách khách thuê"],
  ["/bookings", "Yêu cầu đặt phòng"],
  ["/invoices", "Đơn thu &amp; doanh thu"],
  ["/cashflow", "Thu chi"],
  ["/settings", "Cài đặt"],
]) {
  test(`kết xuất ${pathname}`, async () => {
    const response = await authed(pathname);
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(expected));
  });
}

test("trang Đơn thu hiển thị đủ 32 đơn của kỳ hiện tại", async () => {
  const html = await (await authed("/invoices")).text();
  const codes = new Set(html.match(/DT-\d{6}-\d+-[A-Z]{2}/g) ?? []);
  assert.equal(codes.size, 32);
});

test("trang Thu chi hiển thị giao dịch thật từ sổ", async () => {
  const html = await (await authed("/cashflow")).text();
  assert.ok(new Set(html.match(/GD-\d+/g) ?? []).size > 20, "thiếu dòng sổ thu chi");
});

test("trang Đặt phòng hiển thị yêu cầu thật", async () => {
  const html = await (await authed("/bookings")).text();
  assert.ok(new Set(html.match(/DP-\d+/g) ?? []).size >= 7);
});

/* ------------------------------------------------------------------ */
/* Trang công khai                                                    */
/* ------------------------------------------------------------------ */

test("trang đặt phòng công khai mở cho mọi người", async () => {
  const response = await anonymous("/booking");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Hoàng An/);
});

test("trang công khai không lộ dữ liệu khách thuê", async () => {
  const html = await (await anonymous("/booking")).text();

  // Mã nghiệp vụ riêng tư tuyệt đối không được xuất hiện.
  assert.doesNotMatch(html, /KH-\d/, "lộ mã khách thuê");
  assert.doesNotMatch(html, /HD-\d{3}\b/, "lộ mã hợp đồng");
  assert.doesNotMatch(html, /DT-\d{6}/, "lộ mã đơn thu");
  assert.doesNotMatch(html, /công nợ/i, "lộ thông tin công nợ");

  // Tên và số điện thoại của khách đang thuê lấy từ API quản trị để đối chiếu.
  const { tenants } = await (await authed("/api/tenants")).json();
  for (const tenant of tenants.slice(0, 10)) {
    assert.ok(!html.includes(tenant.fullName), `lộ tên khách thuê: ${tenant.fullName}`);
    assert.ok(!html.includes(tenant.phone), `lộ số điện thoại: ${tenant.phone}`);
  }
});

test("khách gửi được yêu cầu đặt phòng mà không cần đăng nhập", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const vacant = rooms.find((room) => room.status === "Trống");

  const response = await anonymous("/api/booking-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Khách Công Khai",
      phone: "0909008877",
      roomId: vacant.id,
      preferredMoveIn: "2026-12-01",
    }),
  });

  assert.equal(response.status, 201);
  // Không trả về id hay mã: người ngoài không dò được số lượng yêu cầu.
  assert.deepEqual(await response.json(), { ok: true });

  const { bookings } = await (await authed("/api/bookings")).json();
  const created = bookings.find((booking) => booking.fullName === "Khách Công Khai");
  assert.ok(created, "yêu cầu không vào cơ sở dữ liệu");
  assert.equal(created.status, "new", "yêu cầu công khai phải bắt đầu ở trạng thái mới");
});

test("từ chối số điện thoại sai định dạng từ biểu mẫu công khai", async () => {
  const response = await anonymous("/api/booking-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Ai Đó", phone: "123" }),
  });
  assert.equal(response.status, 400);
});

/* ------------------------------------------------------------------ */
/* Phòng và trạng thái suy ra                                         */
/* ------------------------------------------------------------------ */

test("API phòng trả về trạng thái suy ra từ hợp đồng, giữ chỗ và bảo trì", async () => {
  const response = await authed("/api/rooms");
  assert.equal(response.status, 200);

  const { rooms } = await response.json();
  const statuses = new Set(rooms.map((room) => room.status));
  assert.ok(statuses.has("Đang thuê"));
  assert.ok(statuses.has("Trống"));
  assert.ok(statuses.has("Đã giữ"));
  assert.ok(statuses.has("Bảo trì"));

  for (const room of rooms) {
    if (room.status === "Đang thuê") assert.ok(room.tenantName, `${room.code} thiếu khách thuê`);
    else assert.equal(room.tenantName, null, `${room.code} không nên có khách thuê`);
  }
});

test("không cho hai hợp đồng cùng hiệu lực trên một phòng", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const occupied = rooms.find((room) => room.status === "Đang thuê");

  const response = await json("/api/tenants", {
    fullName: "Người Thuê Trùng",
    phone: "0987654321",
    roomId: occupied.id,
    startDate: "2026-09-01",
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /đang có hợp đồng hiệu lực/);
});

test("không cho thuê phòng đang bảo trì", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const broken = rooms.find((room) => room.status === "Bảo trì");

  const response = await json("/api/tenants", {
    fullName: "Người Thuê Mới",
    phone: "0987654321",
    roomId: broken.id,
    startDate: "2026-09-01",
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /đang bảo trì/);
});

test("từ chối số phòng trùng trong cùng một nhà", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const sample = rooms[0];

  const response = await json("/api/rooms", {
    propertyId: sample.propertyId,
    roomTypeId: "bất kỳ",
    number: sample.number,
    floor: 1,
  });

  assert.equal(response.status, 400);
});

test("tạo khách thuê mới làm phòng trống chuyển sang đang thuê", async () => {
  const before = await (await authed("/api/rooms")).json();
  const vacant = before.rooms.find((room) => room.status === "Trống");

  const created = await json("/api/tenants", {
    fullName: "Khách Kiểm Thử",
    phone: "0901112223",
    roomId: vacant.id,
    startDate: "2026-09-01",
  });
  assert.equal(created.status, 201);

  const after = await (await authed("/api/rooms")).json();
  const updated = after.rooms.find((room) => room.id === vacant.id);
  assert.equal(updated.status, "Đang thuê");
  assert.equal(updated.tenantName, "Khách Kiểm Thử");
});

/* ------------------------------------------------------------------ */
/* Thêm nhà và loại phòng                                             */
/* ------------------------------------------------------------------ */

test("thêm nhà mới kèm loại phòng, giữ đúng dấu tiếng Việt", async () => {
  const response = await json("/api/properties", {
    name: "Nhà Hướng Dương",
    code: "hd",
    address: "88 Lê Văn Việt, TP. Thủ Đức",
    roomTypes: [{ name: "Phòng đôi", basePrice: 4500000, area: 30 }],
  });
  assert.equal(response.status, 201);

  const { property } = await response.json();
  assert.equal(property.name, "Nhà Hướng Dương");
  assert.equal(property.code, "HD", "mã nhà phải được viết hoa");

  const { roomTypes } = await (await authed("/api/room-types")).json();
  const own = roomTypes.filter((type) => type.propertyId === property.id);
  assert.deepEqual(own.map((type) => type.name), ["Phòng đôi"]);
});

test("từ chối mã nhà trùng và mã sai định dạng", async () => {
  const duplicate = await json("/api/properties", { name: "Nhà khác", code: "HD" });
  const malformed = await json("/api/properties", { name: "Nhà khác", code: "x" });

  assert.equal(duplicate.status, 400);
  assert.equal(malformed.status, 400);
  assert.match((await duplicate.json()).error, /đã được dùng/);
});

test("từ chối loại phòng trùng tên trong cùng một nhà", async () => {
  const { properties } = await (await authed("/api/properties")).json();
  const target = properties.find((property) => property.code === "HD");

  const first = await json("/api/room-types", {
    propertyId: target.id,
    name: "Phòng đơn",
    basePrice: 2900000,
  });
  const second = await json("/api/room-types", {
    propertyId: target.id,
    name: "Phòng đơn",
    basePrice: 3000000,
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 400);
});

test("phòng của nhà mới hiện ra ở trang đặt phòng công khai", async () => {
  const { properties } = await (await authed("/api/properties")).json();
  const target = properties.find((property) => property.code === "HD");
  const { roomTypes } = await (await authed("/api/room-types")).json();
  const type = roomTypes.find((item) => item.propertyId === target.id);

  const created = await json("/api/rooms", {
    propertyId: target.id,
    roomTypeId: type.id,
    number: "101",
    floor: 1,
  });
  assert.equal(created.status, 201);

  const html = await (await anonymous("/booking")).text();
  assert.match(html, /HD-101/);
});

/* ------------------------------------------------------------------ */
/* Giữ chỗ                                                            */
/* ------------------------------------------------------------------ */

test("xác nhận giữ chỗ làm phòng chuyển sang đã giữ và rời khỏi trang công khai", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const room = rooms.find((item) => item.code === "HD-101");

  await anonymous("/api/booking-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Người Giữ Chỗ", phone: "0912003456", roomId: room.id }),
  });

  const { bookings } = await (await authed("/api/bookings")).json();
  const booking = bookings.find((item) => item.fullName === "Người Giữ Chỗ");

  const confirmed = await json("/api/bookings", { id: booking.id, status: "confirmed" }, "PATCH");
  assert.equal(confirmed.status, 200);

  const after = await (await authed("/api/rooms")).json();
  assert.equal(after.rooms.find((item) => item.id === room.id).status, "Đã giữ");

  const html = await (await anonymous("/booking")).text();
  assert.doesNotMatch(html, /HD-101/, "phòng đang giữ chỗ vẫn hiện công khai");
});

test("không cho hai người cùng giữ một phòng", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const room = rooms.find((item) => item.code === "HD-101");

  await anonymous("/api/booking-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Người Thứ Hai", phone: "0977001122", roomId: room.id }),
  });

  const { bookings } = await (await authed("/api/bookings")).json();
  const second = bookings.find((item) => item.fullName === "Người Thứ Hai");

  const response = await json("/api/bookings", { id: second.id, status: "confirmed" }, "PATCH");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /đang được giữ cho yêu cầu/);
});

test("không xác nhận được yêu cầu chưa gắn phòng cụ thể", async () => {
  await anonymous("/api/booking-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Chưa Chọn Phòng", phone: "0933114455" }),
  });

  const { bookings } = await (await authed("/api/bookings")).json();
  const booking = bookings.find((item) => item.fullName === "Chưa Chọn Phòng");

  const response = await json("/api/bookings", { id: booking.id, status: "confirmed" }, "PATCH");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /chưa gắn với phòng cụ thể/);
});

test("ký hợp đồng cho phòng đang giữ chỗ thì giải phóng chỗ giữ", async () => {
  const { rooms } = await (await authed("/api/rooms")).json();
  const room = rooms.find((item) => item.code === "HD-101");
  assert.equal(room.status, "Đã giữ", "tiền đề: phòng phải đang được giữ");

  const created = await json("/api/tenants", {
    fullName: "Người Giữ Chỗ",
    phone: "0912003456",
    roomId: room.id,
    startDate: "2026-09-01",
  });
  assert.equal(created.status, 201);

  const after = await (await authed("/api/rooms")).json();
  assert.equal(after.rooms.find((item) => item.id === room.id).status, "Đang thuê");

  // Chỗ giữ cũ phải được gỡ, nếu không phòng sẽ hiện lại "Đã giữ" sau khi hết hợp đồng.
  const { bookings } = await (await authed("/api/bookings")).json();
  const stillHeld = bookings.filter(
    (item) => item.roomCode === "HD-101" && item.holdUntil !== null,
  );
  assert.deepEqual(stillHeld, [], "còn chỗ giữ treo lại trên phòng đã có hợp đồng");
});

/* ------------------------------------------------------------------ */
/* Thanh toán và sổ thu chi                                           */
/* ------------------------------------------------------------------ */

test("ghi nhận thanh toán cập nhật đơn thu và sinh dòng thu trong sổ", async () => {
  const { invoices, summary } = await (await authed("/api/invoices")).json();
  const unpaid = invoices.find((invoice) => invoice.outstanding > 0);
  assert.ok(unpaid, "dữ liệu mẫu phải có đơn còn nợ");

  const ledgerBefore = await (await authed("/api/ledger")).json();
  const amount = 2_000_000;

  const paid = await json("/api/payments", { invoiceId: unpaid.id, amount });
  assert.equal(paid.status, 201);
  const result = await paid.json();
  assert.equal(result.paidAmount, unpaid.paidAmount + amount);
  assert.equal(result.remaining, unpaid.outstanding - amount);

  // Đơn thu phải phản ánh ngay số đã thu và trạng thái mới.
  const after = await (await authed("/api/invoices")).json();
  const updated = after.invoices.find((invoice) => invoice.id === unpaid.id);
  assert.equal(updated.paidAmount, unpaid.paidAmount + amount);
  assert.equal(updated.outstanding, unpaid.outstanding - amount);
  assert.equal(updated.status, "partial");

  // Tổng đã thu của kỳ tăng đúng bằng số tiền vừa ghi.
  assert.equal(after.summary.collected - summary.collected, amount);

  // Và sổ thu chi có thêm đúng một dòng thu tương ứng.
  const ledgerAfter = await (await authed("/api/ledger")).json();
  const created = ledgerAfter.entries.find(
    (entry) => !ledgerBefore.entries.some((old) => old.id === entry.id),
  );
  assert.ok(created, "không sinh dòng thu trong sổ");
  assert.equal(created.direction, "in");
  assert.equal(created.amount, amount);
  assert.match(created.description, new RegExp(unpaid.code));
});

test("không thu thêm được khi đơn đã thu đủ", async () => {
  const { invoices } = await (await authed("/api/invoices")).json();
  const settled = invoices.find((invoice) => invoice.outstanding === 0);
  assert.ok(settled, "dữ liệu mẫu phải có đơn đã thu đủ");

  const response = await json("/api/payments", { invoiceId: settled.id, amount: 1000 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /đã thu đủ/);
});

test("từ chối thanh toán lớn hơn phần còn nợ", async () => {
  const { invoices } = await (await authed("/api/invoices")).json();
  const unpaid = invoices.find((invoice) => invoice.outstanding > 0);

  const response = await json("/api/payments", {
    invoiceId: unpaid.id,
    amount: unpaid.outstanding + 1,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /vượt quá phần còn nợ/);
});

test("từ chối thanh toán vào đơn thu không tồn tại", async () => {
  const response = await json("/api/payments", { invoiceId: "khong-ton-tai", amount: 1000 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Không tìm thấy đơn thu/);
});

test("thêm khoản chi vào sổ và tổng chi tăng đúng", async () => {
  const before = await (await authed("/api/ledger")).json();
  const beforeExpense = before.entries
    .filter((entry) => entry.direction === "out")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const created = await json("/api/ledger", {
    direction: "out",
    category: "Bảo trì",
    description: "Sơn lại hành lang",
    amount: 3200000,
  });
  assert.equal(created.status, 201);

  const after = await (await authed("/api/ledger")).json();
  const afterExpense = after.entries
    .filter((entry) => entry.direction === "out")
    .reduce((sum, entry) => sum + entry.amount, 0);

  assert.equal(afterExpense - beforeExpense, 3200000);
});

test("từ chối số tiền không hợp lệ trong sổ thu chi", async () => {
  for (const amount of [0, -5000, "abc"]) {
    const response = await json("/api/ledger", { direction: "in", category: "Khác", amount });
    assert.equal(response.status, 400, `số tiền ${amount} phải bị từ chối`);
  }
});

/* ------------------------------------------------------------------ */
/* Cài đặt                                                            */
/* ------------------------------------------------------------------ */

test("lưu và đọc lại bảng giá", async () => {
  const saved = await json("/api/settings", { "rate.electricity": "3800" }, "PUT");
  assert.equal(saved.status, 200);

  const { settings } = await (await authed("/api/settings")).json();
  assert.equal(settings["rate.electricity"], "3800");
});

test("từ chối giá trị không phải số nguyên trong bảng giá", async () => {
  const response = await json("/api/settings", { "rate.electricity": "ba nghìn" }, "PUT");
  assert.equal(response.status, 400);
});

test("bỏ qua khóa thiết lập không nằm trong danh sách cho phép", async () => {
  const response = await json("/api/settings", { "khoa.la": "giá trị" }, "PUT");
  assert.equal(response.status, 400, "khóa lạ không được tạo thiết lập mới");
});
