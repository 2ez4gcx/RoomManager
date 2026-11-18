/**
 * Kiểm thử kết xuất và nghiệp vụ phía máy chủ.
 *
 * Chạy bản build trong Miniflare (workerd thật + D1 thật) thay vì nạp bằng Node
 * thuần, vì worker có `import cloudflare:workers` mà Node không hiểu, và các
 * trang đã nối cơ sở dữ liệu cần binding `DB` thật mới kết xuất được.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import jsQR from "jsqr";
// Mở lại file Excel do mã tự viết sinh ra, bằng thư viện khác.
import * as XLSX from "xlsx";
// Import thẳng module máy chủ dùng: kiểm chéo băm giữa Node và workerd.
import { hashPassword } from "../db/password-hash.ts";

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

test("đăng nhập được bằng tên đăng nhập ngắn, không bắt buộc là email", async () => {
  // Tự tạo tài khoản thay vì dựa vào dữ liệu mẫu: bài kiểm thử này nói về khả
  // năng đăng nhập bằng tên ngắn, không nên vỡ khi dữ liệu mẫu đổi.
  const created = await json("/api/users", {
    email: "thukho",
    fullName: "Nguyễn Thủ Kho",
    password: "thukho12345",
    role: "staff",
  });
  assert.equal(created.status, 201);

  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.90" },
    // Gõ hoa: hệ thống phải chuẩn hóa về chữ thường.
    body: JSON.stringify({ email: "THUKHO", password: "thukho12345" }),
  });

  assert.equal(response.status, 200, "chữ hoa/thường phải được chuẩn hóa");
  assert.equal((await response.json()).user.role, "staff");
});

test("số tiền lẻ bị từ chối chứ không bị cắt âm thầm", async () => {
  // `toNumber` từng `Math.trunc` giá trị đọc được, vô hiệu hóa 12 chỗ kiểm
  // `Number.isInteger` trong db/. Gõ 1500.7 vào ô tiền thì lặng lẽ thành 1500
  // và được ghi nhận là hợp lệ. Với phần mềm mà giá trị là con số đúng để
  // nhìn, tự sửa con số người dùng gõ là kiểu hỏng tệ nhất.
  const invoices = await (await authed("/api/invoices")).json();
  const conNo = invoices.invoices.find((i) => i.outstanding > 1000);
  assert.ok(conNo, "cần một đơn còn nợ để thử");

  const le = await json("/api/payments", {
    invoiceId: conNo.id,
    amount: 1500.7,
    method: "cash",
  });
  assert.equal(le.status, 400, "số lẻ phải bị từ chối");
  assert.match((await le.json()).error, /số nguyên/i);

  // Và các trường số khác cũng vậy, không riêng tiền.
  const phong = await json("/api/rooms", {
    propertyId: invoices.invoices[0].propertyId ?? "khong-quan-trong",
    roomTypeId: "khong-quan-trong",
    number: "999",
    floor: 1.5,
    price: 1000000,
  });
  assert.equal(phong.status, 400, "số tầng lẻ phải bị từ chối");
});

test("số vòng PBKDF2 không vượt trần của Cloudflare Workers", async () => {
  // Runtime thật từ chối PBKDF2 quá 100.000 vòng: "iteration counts above
  // 100000 are not supported". workerd chạy ở máy KHÔNG áp giới hạn đó, nên
  // toàn bộ bài kiểm thử vẫn xanh trong khi không ai đăng nhập được trên bản
  // deploy — đúng chuyện đã xảy ra ở lần deploy đầu tiên.
  //
  // Bài này canh con số chứ không canh hành vi, vì hành vi ở máy không tái
  // hiện được lỗi.
  const nguon = await readFile(new URL("../db/password-hash.ts", import.meta.url), "utf8");
  const khop = nguon.match(/const PBKDF2_ITERATIONS = ([\d_]+);/);
  assert.ok(khop, "không đọc được số vòng PBKDF2 trong db/password-hash.ts");

  const soVong = Number(khop[1].replaceAll("_", ""));
  assert.ok(soVong > 0, "số vòng phải là số dương");
  assert.ok(
    soVong <= 100_000,
    `PBKDF2 đặt ${soVong.toLocaleString("vi-VN")} vòng, vượt trần 100.000 của Cloudflare Workers. ` +
      "Đặt cao hơn thì không ai đăng nhập được trên bản deploy thật.",
  );

  // Và chuỗi băm sinh ra phải ghi đúng số vòng đó.
  const hash = await hashPassword("kiem-tra-so-vong");
  assert.equal(hash.split("$")[1], String(soVong));
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

test("khởi tạo trống dựng đủ bảng nhưng không có dữ liệu mẫu", async () => {
  // Đường dành cho chủ nhà bắt đầu nhập dữ liệu thật. Dùng cơ sở dữ liệu riêng
  // để không xóa mất dữ liệu mẫu của những bài kiểm thử khác.
  const fresh = await makeWorker("room-manager-empty", { ALLOW_DEV_SETUP: "true" });
  try {
    const setup = await fresh.dispatchFetch("http://localhost/api/dev/setup?empty=true", {
      method: "POST",
    });
    const payload = await setup.json();
    assert.equal(setup.status, 200, JSON.stringify(payload));
    assert.equal(payload.empty, true);
    assert.equal(payload.seeded, false);

    // Bảng phải có thật: trang công khai truy vấn phòng, kết xuất được nghĩa là
    // schema đã dựng xong chứ không phải cơ sở dữ liệu rỗng không.
    const booking = await fresh.dispatchFetch("http://localhost/booking");
    assert.equal(booking.status, 200);

    // Và không còn tài khoản mẫu nào để đăng nhập.
    const login = await fresh.dispatchFetch("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.120" },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    });
    assert.equal(login.status, 401, "tài khoản dữ liệu mẫu không được tồn tại");
  } finally {
    await fresh.dispose();
  }
});

test("tạo được tài khoản chủ nhà đầu tiên trên cơ sở dữ liệu trống", async () => {
  const fresh = await makeWorker("room-manager-bootstrap", { ALLOW_DEV_SETUP: "true" });
  const call = (pathname, init) => fresh.dispatchFetch(`http://localhost${pathname}`, init);
  const owner = {
    email: "chunha@nhatro.vn",
    fullName: "Trần Văn A",
    password: "matkhauthat2026",
    phone: "0901234567",
  };
  const post = (pathname, body) =>
    call(pathname, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.130" },
      body: JSON.stringify(body),
    });

  try {
    await call("/api/dev/setup?empty=true", { method: "POST" });

    const created = await post("/api/dev/create-owner", owner);
    const payload = await created.json();
    assert.equal(created.status, 201, JSON.stringify(payload));
    assert.equal(payload.user.role, "owner");

    const login = await post("/api/auth/login", {
      email: owner.email,
      password: owner.password,
    });
    assert.equal(login.status, 200, "tài khoản vừa tạo phải đăng nhập được");

    // Đã có người đăng nhập được thì route bootstrap phải đóng lại: tạo tài
    // khoản tiếp theo bắt buộc đi qua trang Tài khoản, nơi có kiểm tra quyền.
    const second = await post("/api/dev/create-owner", {
      ...owner,
      email: "kekhac@nhatro.vn",
    });
    assert.equal(second.status, 409);
  } finally {
    await fresh.dispose();
  }
});

test("đường thăm dò /api/dev/status báo đúng trạng thái và không đụng dữ liệu", async () => {
  // `scripts/kiem-tra-sau-deploy.mjs` hỏi đường này thay vì POST vào
  // /api/dev/setup, nên nó phải nói thật ở cả hai chiều — và tuyệt đối không
  // được thay đổi gì.
  const truoc = await authed("/api/rooms");
  const soPhongTruoc = (await truoc.json()).rooms.length;

  const mo = await anonymous("/api/dev/status");
  assert.equal(mo.status, 200, "trong môi trường dev thì nhóm route đang mở");
  assert.equal((await mo.json()).enabled, true);

  const sau = await authed("/api/rooms");
  assert.equal((await sau.json()).rooms.length, soPhongTruoc, "thăm dò không được đụng dữ liệu");

  const locked = await makeWorker("room-manager-locked");
  try {
    const dong = await locked.dispatchFetch("http://localhost/api/dev/status");
    assert.equal(dong.status, 403, "bản production phải báo đã khóa");
  } finally {
    await locked.dispose();
  }
});

test("route tạo chủ nhà cũng bị khóa khi không khai báo ALLOW_DEV_SETUP", async () => {
  const locked = await makeWorker("room-manager-locked");
  try {
    const response = await locked.dispatchFetch("http://localhost/api/dev/create-owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ke@xau.vn", fullName: "Kẻ Xấu", password: "12345678" }),
    });
    assert.equal(response.status, 403);
  } finally {
    await locked.dispose();
  }
});

test("chế độ chỉ áp migration không đụng tới dữ liệu đang có", async () => {
  // `start.bat` gọi chế độ này mỗi lần khởi động khi máy đang chứa dữ liệu
  // thật. Nếu nó lỡ xóa dữ liệu thì mất trắng, nên phải khóa bằng kiểm thử.
  const before = await authed("/api/rooms");
  const { rooms: roomsBefore } = await before.json();

  const response = await anonymous("/api/dev/setup?migrate=true", { method: "POST" });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.seeded, false);

  assert.ok(roomsBefore.length > 0, "bài kiểm thử này cần dữ liệu để so sánh");
  const after = await authed("/api/rooms");
  assert.equal((await after.json()).rooms.length, roomsBefore.length, "dữ liệu bị xóa mất");
});

/* ------------------------------------------------------------------ */
/* Giới hạn số lần đăng nhập sai                                      */
/* ------------------------------------------------------------------ */

/** Đăng nhập kèm IP giả, để mỗi bài kiểm thử có bộ đếm riêng. */
function loginFrom(ip, login, password) {
  return mf.dispatchFetch("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email: login, password }),
    redirect: "manual",
  });
}

test("khóa tạm sau 5 lần sai và trả 429 kèm Retry-After", async () => {
  const ip = "203.0.113.10";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await loginFrom(ip, OWNER_EMAIL, `sai-${attempt}`);
    assert.equal(response.status, 401, `lần ${attempt} phải là 401`);
  }

  const blocked = await loginFrom(ip, OWNER_EMAIL, "sai-6");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0, "thiếu Retry-After");

  const payload = await blocked.json();
  assert.match(payload.error, /quá nhiều lần/);
  assert.ok(payload.retryAfterSeconds > 0);
});

test("mật khẩu đúng cũng bị chặn khi đang trong thời gian khóa", async () => {
  const ip = "203.0.113.11";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await loginFrom(ip, OWNER_EMAIL, "sai");
  }

  // Đây là điểm mấu chốt: khóa rồi thì mật khẩu đúng cũng không vào được,
  // nếu không kẻ tấn công vẫn dò được tới khi trúng.
  const response = await loginFrom(ip, OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(response.status, 429);
});

test("khóa chỉ áp cho cặp tài khoản và IP đó, không khóa người dùng thật", async () => {
  const attacker = "203.0.113.12";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await loginFrom(attacker, OWNER_EMAIL, "sai");
  }
  assert.equal((await loginFrom(attacker, OWNER_EMAIL, OWNER_PASSWORD)).status, 429);

  // Chính chủ ở IP khác vẫn đăng nhập bình thường. Nếu khóa theo riêng tài
  // khoản thì người ngoài chỉ cần biết email là khóa được chủ nhà.
  const owner = await loginFrom("198.51.100.7", OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(owner.status, 200);
});

test("đăng nhập đúng xóa lịch sử sai, không cộng dồn sang lần sau", async () => {
  const ip = "203.0.113.13";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await loginFrom(ip, OWNER_EMAIL, "sai");
  }
  assert.equal((await loginFrom(ip, OWNER_EMAIL, OWNER_PASSWORD)).status, 200);

  // Bộ đếm đã được xóa nên 4 lần sai tiếp theo vẫn chưa chạm ngưỡng.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await loginFrom(ip, OWNER_EMAIL, "sai")).status, 401);
  }
  assert.equal((await loginFrom(ip, OWNER_EMAIL, OWNER_PASSWORD)).status, 200);
});

test("một IP rải nhiều tài khoản khác nhau vẫn bị chặn", async () => {
  const ip = "203.0.113.14";

  // Mỗi tài khoản chỉ thử 4 lần nên không chạm ngưỡng theo cặp; ngưỡng theo
  // IP mới là thứ bắt được kiểu tấn công này.
  for (let account = 0; account < 5; account += 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await loginFrom(ip, `nguoi-dung-${account}@example.com`, "matkhauphobien");
    }
  }

  const response = await loginFrom(ip, "nguoi-dung-moi@example.com", "matkhauphobien");
  assert.equal(response.status, 429);
});

test("bắn nhiều yêu cầu song song không lách được giới hạn", async () => {
  const ip = "203.0.113.16";

  // Gửi 12 yêu cầu cùng lúc. Nếu đếm trước rồi mới ghi thì tất cả cùng đọc bộ
  // đếm cũ và đều lọt qua; ghi trước khi đếm thì phần lớn phải bị chặn.
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => loginFrom(ip, OWNER_EMAIL, "sai")),
  );
  const blocked = responses.filter((response) => response.status === 429).length;

  assert.ok(
    blocked >= 5,
    `chỉ ${blocked}/12 yêu cầu song song bị chặn, giới hạn đang bị lách`,
  );
  assert.equal((await loginFrom(ip, OWNER_EMAIL, OWNER_PASSWORD)).status, 429);
});

test("tài khoản không tồn tại cũng bị đếm, không tiết lộ tài khoản nào có thật", async () => {
  const ip = "203.0.113.15";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await loginFrom(ip, "hoan-toan-khong-co@example.com", "gi-do");
    assert.equal(response.status, 401);
  }
  assert.equal(
    (await loginFrom(ip, "hoan-toan-khong-co@example.com", "gi-do")).status,
    429,
  );
});

/* ------------------------------------------------------------------ */
/* Đổi mật khẩu                                                       */
/* ------------------------------------------------------------------ */

test("đổi mật khẩu yêu cầu đăng nhập", async () => {
  // /api/auth/ được proxy cho qua, nên chính route phải tự kiểm tra phiên.
  const response = await anonymous("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      currentPassword: OWNER_PASSWORD,
      newPassword: "matkhaumoi123",
      confirmPassword: "matkhaumoi123",
    }),
  });
  assert.equal(response.status, 401);
});

test("từ chối đổi mật khẩu khi mật khẩu hiện tại sai", async () => {
  const response = await json("/api/auth/change-password", {
    currentPassword: "sai-hoan-toan",
    newPassword: "matkhaumoi123",
    confirmPassword: "matkhaumoi123",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Mật khẩu hiện tại không đúng/);
});

test("từ chối mật khẩu mới quá ngắn, trùng cũ, hoặc nhập lại không khớp", async () => {
  const tooShort = await json("/api/auth/change-password", {
    currentPassword: OWNER_PASSWORD,
    newPassword: "abc123",
    confirmPassword: "abc123",
  });
  const sameAsOld = await json("/api/auth/change-password", {
    currentPassword: OWNER_PASSWORD,
    newPassword: OWNER_PASSWORD,
    confirmPassword: OWNER_PASSWORD,
  });
  const mismatch = await json("/api/auth/change-password", {
    currentPassword: OWNER_PASSWORD,
    newPassword: "matkhaumoi123",
    confirmPassword: "matkhaumoi124",
  });

  assert.equal(tooShort.status, 400);
  assert.match((await tooShort.json()).error, /ít nhất 8 ký tự/);
  assert.equal(sameAsOld.status, 400);
  assert.match((await sameAsOld.json()).error, /khác mật khẩu hiện tại/);
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /không khớp/);
});

test("đổi mật khẩu thành công, hủy phiên khác nhưng giữ phiên đang dùng", async () => {
  // Phiên thứ hai, giả lập tài khoản đang đăng nhập ở máy khác.
  const otherLogin = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const otherCookie = (otherLogin.headers.get("set-cookie") ?? "").split(";")[0];
  const otherStillWorks = async () =>
    (await mf.dispatchFetch("http://localhost/api/rooms", {
      headers: { cookie: otherCookie },
      redirect: "manual",
    })).status;
  assert.equal(await otherStillWorks(), 200, "tiền đề: phiên thứ hai phải dùng được");

  const newPassword = "matkhaumoi123";
  const changed = await json("/api/auth/change-password", {
    currentPassword: OWNER_PASSWORD,
    newPassword,
    confirmPassword: newPassword,
  });
  assert.equal(changed.status, 200);

  // Phiên đang thao tác vẫn dùng được, không tự đăng xuất chính mình.
  assert.equal((await authed("/api/rooms")).status, 200);
  // Phiên ở máy khác bị đẩy ra.
  assert.equal(await otherStillWorks(), 401);

  // Mật khẩu cũ hết hiệu lực, mật khẩu mới đăng nhập được.
  const oldPassword = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  assert.equal(oldPassword.status, 401);

  const withNew = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: newPassword }),
  });
  assert.equal(withNew.status, 200);

  // Trả mật khẩu về như cũ để bài kiểm thử này không ràng buộc thứ tự chạy
  // với những bài khác cũng đăng nhập bằng OWNER_PASSWORD.
  const restored = await json("/api/auth/change-password", {
    currentPassword: newPassword,
    newPassword: OWNER_PASSWORD,
    confirmPassword: OWNER_PASSWORD,
  });
  assert.equal(restored.status, 200);
});

/* ------------------------------------------------------------------ */
/* Xác thực hai bước                                                  */
/* ------------------------------------------------------------------ */

/**
 * Sinh mã TOTP trong worker để bài kiểm thử đóng vai ứng dụng xác thực.
 *
 * Gọi qua route dev thay vì cài lại thuật toán ở phía kiểm thử: cài lại thì hai
 * bên cùng sai như nhau mà bài kiểm thử vẫn xanh.
 */
const totpState = { secret: "", recoveryCodes: [] };

/**
 * Giải mã ma trận QR bằng jsQR — thư viện khác với thư viện đã sinh mã.
 *
 * Dựng ảnh trắng đen kèm vùng trắng bao quanh, phóng to mỗi ô lên vài điểm ảnh
 * cho giống ảnh chụp màn hình thật.
 */
function decodeQr(matrix) {
  const modules = matrix.length;
  const quiet = 4;
  const scale = 4;
  const size = (modules + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (matrix[row][column] !== "1") continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const x = (column + quiet) * scale + dx;
          const y = (row + quiet) * scale + dy;
          const index = (y * size + x) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    }
  }

  return jsQR(data, size, size)?.data ?? null;
}

async function totpCode(secret, offsetSteps = 0) {
  const response = await authed(
    `/api/dev/totp?secret=${encodeURIComponent(secret)}&offset=${offsetSteps}`,
  );
  assert.equal(response.status, 200, "route sinh mã TOTP lỗi");
  return (await response.json()).code;
}

test("thuật toán TOTP khớp vector kiểm thử của RFC 6238", async () => {
  const response = await authed("/api/dev/totp?rfc=1");
  assert.equal(response.status, 200);

  const { results } = await response.json();
  // Khóa mẫu "12345678901234567890" ở dạng base32, theo phụ lục B của RFC.
  assert.deepEqual(results, [
    { time: 59, code: "287082" },
    { time: 1111111109, code: "081804" },
    { time: 1234567890, code: "005924" },
    { time: 2000000000, code: "279037" },
  ]);
});

test("bật hai bước cần xác nhận bằng mã đúng, sai thì không bật", async () => {
  const begin = await authed("/api/auth/two-factor", { method: "POST" });
  assert.equal(begin.status, 201);

  const { secret, otpauthUri, qrMatrix } = await begin.json();
  assert.match(secret, /^[A-Z2-7]{32}$/, "khóa phải là base32 32 ký tự");
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);
  assert.match(otpauthUri, /issuer=RoomManager/);

  // Ma trận QR phải vuông, mỗi ô chỉ là 0 hoặc 1, kích thước hợp lệ theo chuẩn
  // (phiên bản N có 17 + 4N ô mỗi cạnh).
  assert.ok(Array.isArray(qrMatrix) && qrMatrix.length > 0, "thiếu ma trận QR");
  assert.equal((qrMatrix.length - 17) % 4, 0, `kích thước QR lạ: ${qrMatrix.length}`);
  for (const row of qrMatrix) {
    assert.equal(row.length, qrMatrix.length, "ma trận QR phải vuông");
    assert.match(row, /^[01]+$/);
  }
  // Ba ô định vị ở ba góc luôn tối; thiếu là máy quét không bắt được hướng.
  const last = qrMatrix.length - 1;
  assert.equal(qrMatrix[0][0], "1");
  assert.equal(qrMatrix[0][last], "1");
  assert.equal(qrMatrix[last][0], "1");

  // Kiểm tra cấu trúc thôi thì chưa chứng minh máy quét đọc được. Giải mã lại
  // bằng thư viện khác với thư viện đã sinh, và đối chiếu đúng chuỗi ban đầu.
  const decoded = decodeQr(qrMatrix);
  assert.equal(decoded, otpauthUri, "mã QR không giải ra đúng chuỗi otpauth://");

  // Chưa xác nhận thì chưa bật.
  let status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.enabled, false);
  assert.equal(status.pending, true);

  const wrong = await json("/api/auth/two-factor", { code: "000000" }, "PUT");
  assert.equal(wrong.status, 400);
  status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.enabled, false, "mã sai mà vẫn bật là tự khóa mình ra ngoài");

  const confirmed = await json(
    "/api/auth/two-factor",
    { code: await totpCode(secret) },
    "PUT",
  );
  assert.equal(confirmed.status, 200);

  const payload = await confirmed.json();
  assert.equal(payload.recoveryCodes.length, 8);
  for (const code of payload.recoveryCodes) {
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  }

  status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.enabled, true);
  assert.equal(status.recoveryCodesLeft, 8);

  // Giữ lại cho các bài sau dùng.
  totpState.secret = secret;
  totpState.recoveryCodes = payload.recoveryCodes;
});

test("đăng nhập đúng mật khẩu nhưng chưa nhập mã thì chưa được cấp phiên", async () => {
  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.20" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).needsTotp, true);
  assert.equal(response.headers.get("set-cookie"), null, "không được cấp cookie phiên");
});

test("đăng nhập kèm mã đúng thì vào được, và mã đó không dùng lại được", async () => {
  // Dùng bước kế tiếp: bước hiện tại đã bị tiêu khi xác nhận bật 2FA.
  const code = await totpCode(totpState.secret, 1);

  const first = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.21" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code }),
  });
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie") ?? "", /^rm_session=/);

  // Mã còn hạn tới 30 giây. Dùng lại được thì ai nhìn trộm màn hình vẫn vào được.
  const replay = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.23" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code }),
  });
  assert.equal(replay.status, 401);
});

test("mã khôi phục dùng được một lần rồi thôi", async () => {
  const code = totpState.recoveryCodes[0];

  const first = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.24" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code }),
  });
  assert.equal(first.status, 200);

  const reuse = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.25" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code }),
  });
  assert.equal(reuse.status, 401);

  const status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.recoveryCodesLeft, 7, "phải trừ đúng một mã");
});

test("mật khẩu sai vẫn bị chặn dù mã hai bước hợp lệ", async () => {
  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.26" },
    body: JSON.stringify({
      email: OWNER_EMAIL,
      password: "sai-mat-khau",
      code: totpState.recoveryCodes[1],
    }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).needsTotp, undefined);

  // Mã khôi phục không được tiêu khi mật khẩu sai.
  const status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.recoveryCodesLeft, 7);
});

test("bước chờ nhập mã không bị tính là đăng nhập sai", async () => {
  const ip = "198.51.100.27";

  // Sáu lần "đúng mật khẩu, chưa nhập mã" — nhiều hơn ngưỡng 5 lần sai.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await anonymous("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).needsTotp, true);
  }

  // Nếu bước này bị tính là sai thì người bật 2FA tự khóa mình sau vài lần
  // đăng nhập bình thường.
  const withCode = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      code: totpState.recoveryCodes[1],
    }),
  });
  assert.equal(withCode.status, 200);
});

test("nhập sai mã hai bước thì bị tính vào giới hạn", async () => {
  const ip = "198.51.100.28";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await anonymous("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code: "000000" }),
    });
    assert.equal(response.status, 401);
  }

  const blocked = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, code: "000000" }),
  });
  assert.equal(blocked.status, 429);
});

test("tắt hai bước phải nhập mã hiện tại", async () => {
  const wrong = await json("/api/auth/two-factor", { code: "000000" }, "DELETE");
  assert.equal(wrong.status, 400);

  let status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.enabled, true, "mã sai mà vẫn tắt được thì 2FA vô nghĩa");

  const off = await json(
    "/api/auth/two-factor",
    { code: totpState.recoveryCodes[2] },
    "DELETE",
  );
  assert.equal(off.status, 200);

  status = await (await authed("/api/auth/two-factor")).json();
  assert.equal(status.enabled, false);
  assert.equal(status.recoveryCodesLeft, 0, "mã khôi phục cũ phải bị xóa");

  // Tắt rồi thì đăng nhập không cần mã nữa.
  const login = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.29" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  assert.equal(login.status, 200);
});

/* ------------------------------------------------------------------ */
/* Quản lý tài khoản                                                  */
/* ------------------------------------------------------------------ */

/** Lấy tài khoản theo email từ API quản lý. */
async function findUser(email) {
  const { users } = await (await authed("/api/users")).json();
  return users.find((user) => user.email === email);
}

/** Đăng nhập rồi trả về cookie phiên. IP riêng cho mỗi lần để khỏi đụng giới hạn. */
async function loginCookie(email, password, ip) {
  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `đăng nhập ${email} thất bại`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function withCookie(cookie) {
  return (pathname, init = {}) =>
    mf.dispatchFetch(`http://localhost${pathname}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie },
      redirect: "manual",
    });
}

test("chỉ chủ nhà xem được danh sách tài khoản", async () => {
  assert.equal((await anonymous("/api/users")).status, 401);
  assert.equal((await authed("/api/users")).status, 200);
});

test("tạo tài khoản nhân viên và đăng nhập được bằng tài khoản đó", async () => {
  const created = await json("/api/users", {
    email: "nhanvien@hoangan.vn",
    fullName: "Nhân Viên Một",
    phone: "0909112233",
    password: "nhanvien123",
    role: "staff",
  });
  assert.equal(created.status, 201);

  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.50" },
    body: JSON.stringify({ email: "nhanvien@hoangan.vn", password: "nhanvien123" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, "staff");
});

test("nhân viên không vào được trang và API dành riêng cho chủ nhà", async () => {
  const asStaff = withCookie(
    await loginCookie("nhanvien@hoangan.vn", "nhanvien123", "192.0.2.51"),
  );

  // Đọc dữ liệu vận hành thì được.
  assert.equal((await asStaff("/api/rooms")).status, 200);

  // Nhưng không được đụng vào tài khoản, nhà, loại phòng hay bảng giá.
  assert.equal((await asStaff("/api/users")).status, 403);
  assert.equal((await asStaff("/api/properties")).status, 403);
  assert.equal((await asStaff("/api/room-types")).status, 403);

  // Trang quản lý tài khoản đẩy nhân viên đi chỗ khác.
  const page = await asStaff("/users");
  assert.equal(page.status, 307);
});

test("từ chối email trùng và mật khẩu quá ngắn", async () => {
  const duplicate = await json("/api/users", {
    email: "nhanvien@hoangan.vn",
    fullName: "Trùng Email",
    password: "matkhau12345",
    role: "staff",
  });
  const shortPassword = await json("/api/users", {
    email: "nguoimoi@hoangan.vn",
    fullName: "Mật Khẩu Ngắn",
    password: "abc",
    role: "staff",
  });

  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /đã được dùng/);
  assert.equal(shortPassword.status, 400);
  assert.match((await shortPassword.json()).error, /ít nhất 8 ký tự/);
});

test("khóa tài khoản thì đăng xuất ngay và không đăng nhập lại được", async () => {
  const cookie = await loginCookie("nhanvien@hoangan.vn", "nhanvien123", "192.0.2.52");
  const asStaff = withCookie(cookie);
  assert.equal((await asStaff("/api/rooms")).status, 200, "tiền đề: phiên phải dùng được");

  const staff = await findUser("nhanvien@hoangan.vn");
  assert.equal((await json("/api/users", { id: staff.id, isActive: false }, "PATCH")).status, 200);

  // Khóa mà phiên vẫn sống thì việc khóa không có tác dụng ngay.
  assert.equal((await asStaff("/api/rooms")).status, 401, "phiên cũ vẫn dùng được sau khi khóa");

  const relogin = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.53" },
    body: JSON.stringify({ email: "nhanvien@hoangan.vn", password: "nhanvien123" }),
  });
  assert.equal(relogin.status, 401);

  // Mở khóa lại thì vào được.
  assert.equal((await json("/api/users", { id: staff.id, isActive: true }, "PATCH")).status, 200);
  await loginCookie("nhanvien@hoangan.vn", "nhanvien123", "192.0.2.54");
});

test("chủ nhà đặt lại mật khẩu cho người khác, phiên của người đó bị hủy", async () => {
  const asStaff = withCookie(
    await loginCookie("nhanvien@hoangan.vn", "nhanvien123", "192.0.2.55"),
  );

  const staff = await findUser("nhanvien@hoangan.vn");
  const reset = await json("/api/users", { id: staff.id, newPassword: "matkhaumoi456" }, "PATCH");
  assert.equal(reset.status, 200);

  assert.equal((await asStaff("/api/rooms")).status, 401);
  await loginCookie("nhanvien@hoangan.vn", "matkhaumoi456", "192.0.2.56");
});

test("không tự khóa hay tự hạ quyền chính mình", async () => {
  const me = await findUser(OWNER_EMAIL);

  const selfLock = await json("/api/users", { id: me.id, isActive: false }, "PATCH");
  const selfDemote = await json("/api/users", { id: me.id, role: "staff" }, "PATCH");

  assert.equal(selfLock.status, 400);
  assert.match((await selfLock.json()).error, /chính mình/);
  assert.equal(selfDemote.status, 400);
  assert.match((await selfDemote.json()).error, /chính mình/);
});

test("luôn phải còn ít nhất một chủ nhà đang hoạt động", async () => {
  const { users } = await (await authed("/api/users")).json();
  const me = users.find((user) => user.email === OWNER_EMAIL);

  // Hạ mọi chủ nhà khác xuống nhân viên, chừa lại đúng một người.
  for (const owner of users.filter(
    (user) => user.role === "owner" && user.isActive && user.id !== me.id,
  )) {
    assert.equal((await json("/api/users", { id: owner.id, role: "staff" }, "PATCH")).status, 200);
  }

  // Cấp quyền chủ nhà cho nhân viên rồi hạ lại: được, vì vẫn còn chủ nhà khác.
  const staff = await findUser("nhanvien@hoangan.vn");
  assert.equal((await json("/api/users", { id: staff.id, role: "owner" }, "PATCH")).status, 200);
  assert.equal((await json("/api/users", { id: staff.id, role: "staff" }, "PATCH")).status, 200);

  // Khóa chủ nhà cuối cùng thì bị chặn. Dùng một tài khoản chủ nhà khác để
  // thao tác, vì tự khóa mình đã bị chặn bởi ràng buộc riêng.
  assert.equal((await json("/api/users", { id: staff.id, role: "owner" }, "PATCH")).status, 200);
  const asOtherOwner = withCookie(
    await loginCookie("nhanvien@hoangan.vn", "matkhaumoi456", "192.0.2.57"),
  );
  assert.equal((await json("/api/users", { id: staff.id, role: "staff" }, "PATCH")).status, 200);

  const lockLastOwner = await asOtherOwner("/api/users", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: me.id, isActive: false }),
  });
  assert.equal(lockLastOwner.status, 403, "nhân viên không được khóa tài khoản nào");
});

test("trang quản lý tài khoản kết xuất được cho chủ nhà", async () => {
  const response = await authed("/users");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /nhanvien@hoangan.vn/);
});

/* ------------------------------------------------------------------ */
/* Quên mật khẩu                                                      */
/* ------------------------------------------------------------------ */

/** Lấy phần token trong đường dẫn link đặt lại. */
function tokenFromPath(path) {
  return new URL(path, "http://localhost").searchParams.get("token");
}

test("chỉ chủ nhà cấp được link đặt lại", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");

  assert.equal(
    (await anonymous("/api/auth/reset-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: staff.id }),
    })).status,
    401,
  );

  const asStaff = withCookie(
    await loginCookie("nhanvien@hoangan.vn", "matkhaumoi456", "203.0.113.60"),
  );
  const staffTry = await asStaff("/api/auth/reset-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: staff.id }),
  });
  assert.equal(staffTry.status, 403, "nhân viên không được tự cấp link");
});

test("đặt lại mật khẩu bằng link, xong thì mọi phiên bị hủy", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");

  // Phiên đang mở của người dùng, để kiểm tra nó bị đẩy ra sau khi đổi.
  const asStaff = withCookie(
    await loginCookie("nhanvien@hoangan.vn", "matkhaumoi456", "203.0.113.61"),
  );
  assert.equal((await asStaff("/api/rooms")).status, 200);

  const created = await json("/api/auth/reset-link", { userId: staff.id });
  assert.equal(created.status, 201);

  const { path, expiresAt } = await created.json();
  const token = tokenFromPath(path);
  assert.ok(token && token.length >= 40, "token phải đủ dài để không đoán được");
  assert.ok(new Date(expiresAt).getTime() > Date.now(), "link phải còn hạn");

  // Trang đặt lại tra được link trước khi người dùng gõ gì.
  const info = await (await anonymous(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)).json();
  assert.equal(info.valid, true);
  assert.equal(info.fullName, "Nhân Viên Một");

  const done = await anonymous("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      newPassword: "matkhausau789",
      confirmPassword: "matkhausau789",
    }),
  });
  assert.equal(done.status, 200);

  // Không cấp phiên: đặt lại xong vẫn phải tự đăng nhập, nhờ vậy tài khoản bật
  // hai bước vẫn bị hỏi mã.
  assert.equal(done.headers.get("set-cookie"), null);

  assert.equal((await asStaff("/api/rooms")).status, 401, "phiên cũ phải bị hủy");
  await loginCookie("nhanvien@hoangan.vn", "matkhausau789", "203.0.113.62");
});

test("link chỉ dùng được một lần", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");
  const token = tokenFromPath((await (await json("/api/auth/reset-link", { userId: staff.id })).json()).path);

  const body = (password) =>
    JSON.stringify({ token, newPassword: password, confirmPassword: password });

  assert.equal(
    (await anonymous("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body("matkhaulan1x"),
    })).status,
    200,
  );

  const again = await anonymous("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body("matkhaulan2x"),
  });
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /đã dùng rồi|hết hạn/);

  // Mật khẩu vẫn là của lần đặt đầu tiên.
  await loginCookie("nhanvien@hoangan.vn", "matkhaulan1x", "203.0.113.63");
});

test("cấp link mới thì link cũ hết hiệu lực", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");
  const first = tokenFromPath((await (await json("/api/auth/reset-link", { userId: staff.id })).json()).path);
  const second = tokenFromPath((await (await json("/api/auth/reset-link", { userId: staff.id })).json()).path);
  assert.notEqual(first, second);

  // Để nhiều link cùng sống nghĩa là mỗi lần bấm nhầm lại thêm một chìa khóa
  // đang trôi nổi.
  const oldOne = await (await anonymous(`/api/auth/reset-password?token=${encodeURIComponent(first)}`)).json();
  assert.equal(oldOne.valid, false);

  const newOne = await (await anonymous(`/api/auth/reset-password?token=${encodeURIComponent(second)}`)).json();
  assert.equal(newOne.valid, true);
});

test("từ chối token bịa, mật khẩu quá ngắn và hai lần nhập lệch nhau", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");
  const token = tokenFromPath((await (await json("/api/auth/reset-link", { userId: staff.id })).json()).path);

  const fake = await anonymous("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "token-bia-ra",
      newPassword: "matkhaudai12",
      confirmPassword: "matkhaudai12",
    }),
  });
  const short = await anonymous("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: "abc", confirmPassword: "abc" }),
  });
  const mismatch = await anonymous("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: "matkhaudai12", confirmPassword: "matkhaukhac9" }),
  });

  assert.equal(fake.status, 400);
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /ít nhất 8 ký tự/);
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /không khớp/);
});

test("không cấp link cho tài khoản đang bị khóa", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");
  assert.equal((await json("/api/users", { id: staff.id, isActive: false }, "PATCH")).status, 200);

  const blocked = await json("/api/auth/reset-link", { userId: staff.id });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /đang bị khóa/);

  assert.equal((await json("/api/users", { id: staff.id, isActive: true }, "PATCH")).status, 200);
});

test("trang đặt lại mật khẩu mở cho người chưa đăng nhập", async () => {
  const staff = await findUser("nhanvien@hoangan.vn");
  const token = tokenFromPath((await (await json("/api/auth/reset-link", { userId: staff.id })).json()).path);

  const good = await anonymous(`/dat-lai-mat-khau?token=${encodeURIComponent(token)}`);
  assert.equal(good.status, 200);
  assert.match(await good.text(), /Đặt lại mật khẩu/);

  // Link hỏng thì báo ngay, không bắt người dùng gõ xong mới biết.
  const bad = await anonymous("/dat-lai-mat-khau?token=khong-dung");
  assert.equal(bad.status, 200);
  assert.match(await bad.text(), /Link không dùng được/);
});

test("chuỗi băm do script cứu hộ sinh ở Node được worker chấp nhận", async () => {
  // Đường cứu hộ khi chủ nhà duy nhất quên mật khẩu: sai định dạng băm là khóa
  // vĩnh viễn, nên phải kiểm chéo giữa hai runtime chứ không tin vào việc "hai
  // bên dùng chung một file".
  const password = "matkhaucuuho2026";
  const hash = await hashPassword(password);

  const accepted = await anonymous("/api/dev/verify-hash", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, hash }),
  });
  assert.equal((await accepted.json()).valid, true, "worker không đọc được băm sinh từ Node");

  const rejected = await anonymous("/api/dev/verify-hash", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "sai-mat-khau", hash }),
  });
  assert.equal((await rejected.json()).valid, false);
});

/* ------------------------------------------------------------------ */
/* Lập đơn thu theo kỳ                                                */
/* ------------------------------------------------------------------ */

/** Kỳ kế tiếp: dữ liệu mẫu đã lập đơn cho kỳ hiện tại rồi. */
function nextPeriod(offset = 1) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 7);
}

function lastDayOf(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function preview(period) {
  const response = await authed(`/api/billing?period=${period}`);
  assert.equal(response.status, 200);
  return response.json();
}

test("xem trước liệt kê mọi hợp đồng còn hiệu lực kèm chỉ số điện kỳ trước", async () => {
  const period = nextPeriod();
  const data = await preview(period);

  assert.equal(data.period, period);
  assert.equal(data.rows.length, 32, "phải có đủ 32 hợp đồng đang thuê");
  assert.equal(data.alreadyIssued, 0, "kỳ sau chưa lập đơn nào");

  // Chỉ số cũ phải lấy từ lần chốt gần nhất, không phải 0.
  const withReading = data.rows.filter((row) => row.previousReading > 0);
  assert.equal(withReading.length, 32, "thiếu chỉ số điện kỳ trước");

  for (const row of data.rows) {
    assert.ok(row.rent > 0);
    assert.ok(row.occupants >= 1);
    assert.match(row.dueDate, new RegExp(`^${period}-\\d{2}$`));
    assert.equal(row.existingInvoiceCode, null);
  }
});

test("kỳ hiện tại báo đã lập đơn rồi, không lập lại", async () => {
  const data = await preview(new Date().toISOString().slice(0, 7));
  assert.equal(data.alreadyIssued, 32);
  assert.ok(data.rows.every((row) => row.existingInvoiceCode));
});

test("phát hành đơn tính đúng tiền điện, nước, dịch vụ và tiền phòng", async () => {
  const period = nextPeriod();
  const before = await preview(period);
  const target = before.rows[0];
  const used = 120;

  const issued = await json("/api/billing", {
    period,
    entries: [
      {
        contractId: target.contractId,
        currentReading: target.previousReading + used,
        occupants: 2,
      },
    ],
  });
  assert.equal(issued.status, 201);
  assert.deepEqual(await issued.json(), { created: 1, skipped: 0, total: 1 });

  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = invoices.find((row) => row.roomCode === target.roomCode);
  assert.ok(invoice, "không thấy đơn vừa lập");

  const expected =
    target.rent +
    used * before.rates.electricity +
    2 * before.rates.water +
    before.rates.service;
  assert.equal(invoice.total, expected, "tổng đơn không khớp");
  assert.equal(invoice.paidAmount, 0);
  assert.equal(invoice.status, "issued");

  // Bốn dòng: tiền phòng, điện, nước, dịch vụ.
  assert.equal(invoice.items.length, 4);
  const electricity = invoice.items.find((item) => item.kind === "electricity");
  assert.equal(electricity.quantity, used);
  assert.equal(electricity.unitPrice, before.rates.electricity);
  assert.equal(electricity.amount, used * before.rates.electricity);
});

test("chốt sổ lần nữa thì bỏ qua phòng đã có đơn, không tạo trùng", async () => {
  const period = nextPeriod();
  const data = await preview(period);
  const issuedRow = data.rows.find((row) => row.existingInvoiceCode);
  assert.ok(issuedRow, "tiền đề: phải có phòng đã lập đơn ở bài trước");

  const again = await json("/api/billing", {
    period,
    entries: [{ contractId: issuedRow.contractId, currentReading: issuedRow.previousReading + 5 }],
  });
  assert.equal(again.status, 200, "không tạo đơn nào thì không phải 201 Created");
  assert.deepEqual(await again.json(), { created: 0, skipped: 1, total: 1 });

  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const forRoom = invoices.filter((row) => row.roomCode === issuedRow.roomCode);
  assert.equal(forRoom.length, 1, "tạo trùng đơn cho cùng phòng và kỳ");
});

test("phát hành cả kỳ trong một lượt, đủ 32 đơn", async () => {
  // Bài này chạy ở quy mô thật. Chèn nhiều dòng một lúc từng làm vỡ giới hạn
  // tham số ràng buộc của D1, mà chèn lẻ vài dòng thì không lộ ra.
  const period = nextPeriod(5);
  const data = await preview(period);
  assert.equal(data.alreadyIssued, 0);

  const response = await json("/api/billing", {
    period,
    entries: data.rows.map((row, index) => ({
      contractId: row.contractId,
      currentReading: row.previousReading + 50 + index,
      occupants: 2,
    })),
  });
  assert.equal(response.status, 201);

  const result = await response.json();
  assert.equal(result.created, data.rows.length);
  assert.equal(result.skipped, 0);

  const { invoices, summary } = await (await authed(`/api/invoices?period=${period}`)).json();
  assert.equal(invoices.length, data.rows.length);
  assert.ok(summary.billed > 0);

  // Mỗi đơn phải có đủ bốn dòng, không đơn nào bị chèn hụt.
  for (const invoice of invoices) {
    assert.equal(invoice.items.length, 4, `${invoice.code} thiếu dòng`);
    assert.equal(
      invoice.items.reduce((sum, item) => sum + item.amount, 0),
      invoice.total,
      `${invoice.code} tổng không khớp các dòng`,
    );
  }
});

test("từ chối chỉ số điện nhỏ hơn chỉ số cũ", async () => {
  const period = nextPeriod();
  const data = await preview(period);
  const target = data.rows.find((row) => !row.existingInvoiceCode && row.previousReading > 10);

  const response = await json("/api/billing", {
    period,
    entries: [{ contractId: target.contractId, currentReading: target.previousReading - 1 }],
  });

  // Công tơ không quay ngược; đây gần như chắc chắn là gõ nhầm.
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /không được nhỏ hơn chỉ số cũ/);
});

test("chỉ số kỳ này thành chỉ số cũ của kỳ sau", async () => {
  const period = nextPeriod();
  const after = nextPeriod(2);

  const data = await preview(period);
  const target = data.rows.find((row) => !row.existingInvoiceCode);
  const newReading = target.previousReading + 77;

  assert.equal(
    (await json("/api/billing", {
      period,
      entries: [{ contractId: target.contractId, currentReading: newReading }],
    })).status,
    201,
  );

  const next = await preview(after);
  const sameRoom = next.rows.find((row) => row.contractId === target.contractId);
  assert.equal(sameRoom.previousReading, newReading, "chuỗi chỉ số bị đứt giữa hai kỳ");
});

test("hợp đồng bắt đầu giữa kỳ thì tiền phòng chia theo ngày", async () => {
  const period = nextPeriod(3);
  const days = lastDayOf(period);
  const startDay = 15;

  const { rooms } = await (await authed("/api/rooms")).json();
  const vacant = rooms.find((room) => room.status === "Trống");
  assert.ok(vacant, "cần một phòng trống để ký hợp đồng thử");

  const created = await json("/api/tenants", {
    fullName: "Khách Vào Giữa Tháng",
    phone: "0903334445",
    roomId: vacant.id,
    startDate: `${period}-${startDay}`,
  });
  assert.equal(created.status, 201);

  const data = await preview(period);
  const row = data.rows.find((item) => item.roomCode === vacant.code);
  assert.ok(row, "hợp đồng mới không xuất hiện trong kỳ");

  // Ở từ ngày 15 tới hết tháng, làm tròn tới nghìn đồng.
  const daysCharged = days - startDay + 1;
  const expected = Math.round((vacant.price * daysCharged) / days / 1000) * 1000;
  assert.equal(row.rent, expected, "tiền phòng không được chia theo ngày");
  assert.match(row.rentNote, new RegExp(`${daysCharged}/${days} ngày`));

  // Thu trọn tháng của người dọn vào giữa kỳ là thu sai.
  assert.ok(row.rent < vacant.price);
});

test("hợp đồng bắt đầu sau kỳ thì không nằm trong kỳ đó", async () => {
  const later = nextPeriod(3);
  const earlier = nextPeriod(2);

  const laterRows = (await preview(later)).rows.map((row) => row.roomCode);
  const earlierRows = (await preview(earlier)).rows.map((row) => row.roomCode);

  const newTenantRoom = laterRows.find((code) => !earlierRows.includes(code));
  assert.ok(newTenantRoom, "hợp đồng ký cho kỳ sau lại xuất hiện ở kỳ trước");
});

test("từ chối kỳ thu sai định dạng", async () => {
  for (const bad of ["2026-13", "202608", "thang-8"]) {
    const response = await authed(`/api/billing?period=${encodeURIComponent(bad)}`);
    assert.equal(response.status, 400, `kỳ "${bad}" phải bị từ chối`);
  }
});

test("lập đơn thu yêu cầu đăng nhập", async () => {
  assert.equal((await anonymous("/api/billing")).status, 401);
  assert.equal(
    (await anonymous("/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period: nextPeriod(), entries: [] }),
    })).status,
    401,
  );
});

test("trang lập đơn thu kết xuất được", async () => {
  const response = await authed(`/lap-don-thu?period=${nextPeriod(4)}`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Lập đơn thu/);
  assert.match(html, /Chỉ số cũ/);
});

/* ------------------------------------------------------------------ */
/* Trả phòng                                                          */
/* ------------------------------------------------------------------ */

/** Tổng thu và tổng chi của toàn bộ sổ quỹ, dùng để đối chiếu dòng tiền. */
async function ledgerTotals() {
  const { entries } = await (await authed("/api/ledger?limit=1000")).json();
  return {
    inCount: entries.filter((entry) => entry.direction === "in").length,
    deposits: entries
      .filter((entry) => entry.category === "Tiền cọc")
      .reduce((sum, entry) => sum + entry.amount, 0),
    refunds: entries
      .filter((entry) => entry.category === "Hoàn cọc")
      .reduce((sum, entry) => sum + entry.amount, 0),
  };
}

/** Thuê một phòng trống rồi trả về hợp đồng vừa ký. */
async function rentARoom(name, phone, deposit) {
  const { rooms } = await (await authed("/api/rooms")).json();
  const vacant = rooms.find((room) => room.status === "Trống");
  assert.ok(vacant, "cần một phòng trống");

  const created = await json("/api/tenants", {
    fullName: name,
    phone,
    roomId: vacant.id,
    startDate: new Date().toISOString().slice(0, 10),
    deposit,
  });
  assert.equal(created.status, 201);

  const { tenants } = await (await authed("/api/tenants")).json();
  const tenant = tenants.find((row) => row.fullName === name);
  return { tenant, room: vacant };
}

test("tiền cọc được ghi vào sổ quỹ ngay khi ký hợp đồng", async () => {
  const before = await ledgerTotals();
  const { room } = await rentARoom("Khách Có Cọc", "0905550001", 5000000);
  const after = await ledgerTotals();

  // Không ghi cọc lúc thu thì lúc hoàn cọc sổ sẽ hiện thành lỗ.
  assert.equal(after.deposits - before.deposits, 5000000, `cọc phòng ${room.code} không vào sổ`);
});

test("xem trước trả phòng cho biết cọc và tiền còn nợ", async () => {
  const { tenants } = await (await authed("/api/tenants")).json();
  const tenant = tenants.find((row) => row.fullName === "Khách Có Cọc");

  const response = await authed(
    `/api/move-out?contractId=${encodeURIComponent(tenant.contractId)}`,
  );
  assert.equal(response.status, 200);

  const preview = await response.json();
  assert.equal(preview.deposit, 5000000);
  assert.equal(preview.outstanding, 0, "hợp đồng mới chưa có đơn nào");
  assert.deepEqual(preview.unpaidInvoices, []);
});

test("trả phòng khi không nợ thì hoàn đủ cọc và phòng thành trống", async () => {
  const { tenants } = await (await authed("/api/tenants")).json();
  const tenant = tenants.find((row) => row.fullName === "Khách Có Cọc");
  const roomCode = tenant.roomCode;
  const before = await ledgerTotals();

  const response = await json("/api/move-out", {
    contractId: tenant.contractId,
    endDate: new Date().toISOString().slice(0, 10),
    reason: "Chuyển chỗ ở",
  });
  assert.equal(response.status, 200);

  assert.deepEqual(await response.json(), {
    settledFromDeposit: 0,
    deductionKept: 0,
    refund: 5000000,
    stillOwed: 0,
  });

  // Khoản hoàn phải ra sổ quỹ, vì tiền mặt thật sự rời két.
  const after = await ledgerTotals();
  assert.equal(after.refunds - before.refunds, 5000000);

  // Trạng thái phòng suy từ hợp đồng, nên hết hợp đồng là phòng trống ngay.
  const { rooms } = await (await authed("/api/rooms")).json();
  assert.equal(rooms.find((room) => room.code === roomCode).status, "Trống");

  const { tenants: after2 } = await (await authed("/api/tenants")).json();
  assert.equal(after2.find((row) => row.fullName === "Khách Có Cọc").status, "Đã trả phòng");
});

test("không trả phòng hai lần cho cùng một hợp đồng", async () => {
  const { tenant } = await rentARoom("Khách Trả Hai Lần", "0905550009", 1000000);
  // Giữ lại id: sau khi trả phòng, danh sách khách thuê chỉ nối hợp đồng còn
  // hiệu lực nên không trả về contractId nữa.
  const contractId = tenant.contractId;
  const endDate = new Date().toISOString().slice(0, 10);

  assert.equal((await json("/api/move-out", { contractId, endDate })).status, 200);

  const again = await json("/api/move-out", { contractId, endDate });
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /đã kết thúc rồi/);
});

test("hai lần trả phòng song song chỉ hoàn cọc một lần", async () => {
  const { tenant } = await rentARoom("Khách Trả Song Song", "0905550031", 2000000);
  const before = await ledgerTotals();

  const body = { contractId: tenant.contractId, endDate: new Date().toISOString().slice(0, 10) };
  const responses = await Promise.all([json("/api/move-out", body), json("/api/move-out", body)]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 400], "phải đúng một lần thành công");

  const after = await ledgerTotals();
  assert.equal(after.refunds - before.refunds, 2000000, "cọc bị hoàn hai lần");
});

test("cọc được cấn vào đơn còn nợ, phần dư mới hoàn lại", async () => {
  const { tenant, room } = await rentARoom("Khách Còn Nợ", "0905550002", 6000000);

  // Lập một đơn cho phòng này để tạo khoản nợ.
  const period = nextPeriod(8);
  const data = await preview(period);
  const target = data.rows.find((row) => row.roomCode === room.code);
  assert.ok(target, "hợp đồng mới phải nằm trong kỳ");

  assert.equal(
    (await json("/api/billing", {
      period,
      entries: [{ contractId: target.contractId, currentReading: target.previousReading }],
    })).status,
    201,
  );

  const before = await ledgerTotals();
  const settle = await (
    await authed(`/api/move-out?contractId=${encodeURIComponent(tenant.contractId)}`)
  ).json();
  assert.ok(settle.outstanding > 0, "phải có nợ để kiểm tra cấn trừ");

  const response = await json("/api/move-out", {
    contractId: tenant.contractId,
    endDate: new Date().toISOString().slice(0, 10),
  });
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.equal(result.settledFromDeposit, settle.outstanding);
  assert.equal(result.refund, 6000000 - settle.outstanding);
  assert.equal(result.stillOwed, 0);

  // Phần cấn trừ KHÔNG được ghi sổ lần nữa: tiền đã vào từ lúc thu cọc.
  const after = await ledgerTotals();
  assert.equal(
    after.refunds - before.refunds,
    result.refund,
    "chỉ phần hoàn lại mới ra sổ quỹ",
  );

  // Đơn phải được đánh dấu đã thu đủ.
  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = invoices.find((row) => row.roomCode === room.code);
  assert.equal(invoice.outstanding, 0);
  assert.equal(invoice.status, "paid");
});

test("cọc không đủ thì phần thiếu vẫn còn nợ, không tự xóa", async () => {
  const { tenant, room } = await rentARoom("Khách Cọc Ít", "0905550003", 100000);

  const period = nextPeriod(9);
  const data = await preview(period);
  const target = data.rows.find((row) => row.roomCode === room.code);
  assert.equal(
    (await json("/api/billing", {
      period,
      entries: [{ contractId: target.contractId, currentReading: target.previousReading }],
    })).status,
    201,
  );

  const settle = await (
    await authed(`/api/move-out?contractId=${encodeURIComponent(tenant.contractId)}`)
  ).json();

  const result = await (
    await json("/api/move-out", {
      contractId: tenant.contractId,
      endDate: new Date().toISOString().slice(0, 10),
    })
  ).json();

  assert.equal(result.settledFromDeposit, 100000);
  assert.equal(result.refund, 0);
  assert.equal(result.stillOwed, settle.outstanding - 100000);

  // Nợ còn lại vẫn là tiền chủ nhà có quyền đòi, không được tự xóa.
  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = invoices.find((row) => row.roomCode === room.code);
  assert.equal(invoice.outstanding, result.stillOwed);
  assert.equal(invoice.status, "partial");
});

test("khấu trừ hư hỏng lấy từ phần cọc còn lại", async () => {
  const { tenant } = await rentARoom("Khách Bị Trừ", "0905550004", 4000000);

  const result = await (
    await json("/api/move-out", {
      contractId: tenant.contractId,
      endDate: new Date().toISOString().slice(0, 10),
      deductions: 700000,
      deductionNote: "Vỡ kính cửa sổ",
    })
  ).json();

  assert.equal(result.deductionKept, 700000);
  assert.equal(result.refund, 3300000);
});

test("khấu trừ không vượt quá phần cọc còn lại", async () => {
  const { tenant } = await rentARoom("Khách Trừ Quá", "0905550005", 500000);

  const result = await (
    await json("/api/move-out", {
      contractId: tenant.contractId,
      endDate: new Date().toISOString().slice(0, 10),
      deductions: 9000000,
    })
  ).json();

  // Giữ nhiều hơn số cọc đang cầm là không có cơ sở.
  assert.equal(result.deductionKept, 500000);
  assert.equal(result.refund, 0);
});

test("từ chối ngày trả phòng trước ngày bắt đầu hợp đồng", async () => {
  const { tenant } = await rentARoom("Khách Ngày Sai", "0905550006", 1000000);

  const response = await json("/api/move-out", {
    contractId: tenant.contractId,
    endDate: "2000-01-01",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /không được trước ngày bắt đầu/);
});

test("phòng vừa trả cho thuê lại được ngay", async () => {
  const { tenant, room } = await rentARoom("Khách Ở Ngắn", "0905550007", 1000000);

  assert.equal(
    (await json("/api/move-out", {
      contractId: tenant.contractId,
      endDate: new Date().toISOString().slice(0, 10),
    })).status,
    200,
  );

  const relet = await json("/api/tenants", {
    fullName: "Khách Kế Tiếp",
    phone: "0905550008",
    roomId: room.id,
    startDate: new Date().toISOString().slice(0, 10),
  });
  assert.equal(relet.status, 201, "phòng đã trả mà vẫn không cho thuê lại được");

  const { rooms } = await (await authed("/api/rooms")).json();
  const updated = rooms.find((item) => item.id === room.id);
  assert.equal(updated.status, "Đang thuê");
  assert.equal(updated.tenantName, "Khách Kế Tiếp");
});

test("trả phòng yêu cầu đăng nhập", async () => {
  assert.equal((await anonymous("/api/move-out?contractId=abc")).status, 401);
  assert.equal(
    (await anonymous("/api/move-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractId: "abc", endDate: "2026-01-01" }),
    })).status,
    401,
  );
});

/* ------------------------------------------------------------------ */
/* Hủy đơn thu                                                        */
/* ------------------------------------------------------------------ */

/** Lập một đơn mới ở kỳ chưa dùng, trả về đơn vừa lập. */
async function issueOneInvoice(periodOffset, readingDelta = 100) {
  const period = nextPeriod(periodOffset);
  const data = await preview(period);
  const target = data.rows.find((row) => !row.existingInvoiceCode);
  assert.ok(target, `kỳ ${period} không còn hợp đồng nào để lập đơn`);

  const issued = await json("/api/billing", {
    period,
    entries: [
      { contractId: target.contractId, currentReading: target.previousReading + readingDelta },
    ],
  });
  assert.equal(issued.status, 201);

  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = invoices.find((row) => row.roomCode === target.roomCode);
  return { period, invoice, target };
}

test("hủy đơn cần lý do", async () => {
  const { invoice } = await issueOneInvoice(10);

  const response = await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "  " });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /lý do hủy/);
});

test("hủy đơn thì đơn không mất, chỉ đổi trạng thái", async () => {
  const { period, invoice } = await issueOneInvoice(11);

  const response = await json("/api/invoices/cancel", {
    invoiceId: invoice.id,
    reason: "Nhập nhầm chỉ số điện",
  });
  assert.equal(response.status, 200);

  const { invoices, summary } = await (await authed(`/api/invoices?period=${period}`)).json();
  const after = invoices.find((row) => row.id === invoice.id);

  // Giữ lại để truy vết, không xóa cứng.
  assert.ok(after, "đơn bị xóa mất thay vì chuyển trạng thái");
  assert.equal(after.status, "cancelled");
  assert.equal(after.statusLabel, "Đã hủy");
  assert.equal(after.outstanding, 0, "đơn đã hủy vẫn hiện còn nợ");

  // Không còn tính vào doanh thu của kỳ.
  assert.equal(summary.billed, 0, "đơn đã hủy vẫn tính vào phải thu");
});

test("đơn đã hủy không còn tính vào công nợ của khách", async () => {
  const { period, invoice, target } = await issueOneInvoice(12);

  const before = await (await authed("/api/rooms")).json();
  const roomBefore = before.rooms.find((room) => room.code === target.roomCode);
  assert.ok(roomBefore.outstanding > 0, "tiền đề: phòng phải đang có nợ");

  assert.equal(
    (await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "Lập trùng" })).status,
    200,
  );

  const after = await (await authed("/api/rooms")).json();
  const roomAfter = after.rooms.find((room) => room.code === target.roomCode);
  assert.equal(roomAfter.outstanding, 0);
  assert.ok(period);
});

test("hủy xong lập lại được đơn cho đúng kỳ đó", async () => {
  const { period, invoice, target } = await issueOneInvoice(13, 80);

  assert.equal(
    (await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "Sai chỉ số" })).status,
    200,
  );

  // Ràng buộc UNIQUE là index một phần bỏ qua đơn đã hủy, nếu không thì kỳ này
  // bị khóa vĩnh viễn sau một lần lập nhầm.
  const again = await preview(period);
  const row = again.rows.find((item) => item.contractId === target.contractId);
  assert.equal(row.existingInvoiceCode, null, "kỳ vẫn bị coi là đã lập");

  const reissued = await json("/api/billing", {
    period,
    entries: [{ contractId: target.contractId, currentReading: row.previousReading + 55 }],
  });
  assert.equal(reissued.status, 201, `lập lại thất bại: ${await reissued.clone().text()}`);
  assert.equal((await reissued.json()).created, 1);

  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const live = invoices.filter(
    (item) => item.roomCode === target.roomCode && item.status !== "cancelled",
  );
  assert.equal(live.length, 1, "còn nhiều hơn một đơn còn hiệu lực cho cùng kỳ");

  const electricity = live[0].items.find((item) => item.kind === "electricity");
  assert.equal(electricity.quantity, 55);

  // Mã đơn mới phải khác mã đơn đã hủy, để nhắc tới mã nào là rõ đơn nào.
  assert.notEqual(live[0].code, invoice.code);
  assert.match(live[0].code, /-L2$/);
});

test("không hủy đơn đã thu tiền", async () => {
  const { invoice } = await issueOneInvoice(14);

  assert.equal(
    (await json("/api/payments", { invoiceId: invoice.id, amount: 100000 })).status,
    201,
  );

  const response = await json("/api/invoices/cancel", {
    invoiceId: invoice.id,
    reason: "Thử hủy sau khi đã thu",
  });

  // Hủy đơn đã thu sẽ để lại khoản thanh toán treo không thuộc đơn nào.
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Hoàn tiền cho khách trước/);
});

test("không hủy hai lần cùng một đơn", async () => {
  const { invoice } = await issueOneInvoice(15);

  assert.equal(
    (await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "Lần một" })).status,
    200,
  );

  const again = await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "Lần hai" });
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /đã hủy rồi/);
});

test("hủy đơn không làm mất mốc chỉ số điện đầu kỳ", async () => {
  // Dùng đơn của kỳ hiện tại trong dữ liệu mẫu: chỉ số đầu kỳ là 1200, khác 0,
  // nên nếu mốc bị mất thì bài kiểm thử phát hiện được.
  const period = new Date().toISOString().slice(0, 7);
  const before = await preview(period);
  const target = before.rows[0];
  const { invoices: list } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = list.find((row) => row.roomCode === target.roomCode);

  const startMark = Number(
    invoice.items.find((item) => item.kind === "electricity").description.match(/\d+/)[0],
  );
  assert.ok(startMark > 0, "tiền đề: chỉ số đầu kỳ phải khác 0");
  const readingBefore = startMark;

  assert.equal(
    (await json("/api/invoices/cancel", { invoiceId: invoice.id, reason: "Sai số" })).status,
    200,
  );

  // Xóa hẳn bản ghi chỉ số thì mốc đầu kỳ biến mất, lập lại sẽ tính từ 0 và ra
  // một hóa đơn điện khổng lồ.
  const after = await preview(period);
  const row = after.rows.find((item) => item.contractId === target.contractId);
  assert.equal(row.previousReading, readingBefore, "mất mốc chỉ số đầu kỳ sau khi hủy");

  // Lập lại với đúng chỉ số thật thì tiền điện phải hợp lý, không nhảy vọt.
  assert.equal(
    (await json("/api/billing", {
      period,
      entries: [{ contractId: target.contractId, currentReading: readingBefore + 90 }],
    })).status,
    201,
  );

  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const live = invoices.find(
    (item) => item.roomCode === target.roomCode && item.status !== "cancelled",
  );
  const electricity = live.items.find((item) => item.kind === "electricity");
  assert.equal(electricity.quantity, 90, "tiền điện tính từ mốc sai");
  assert.match(electricity.description, new RegExp(`${readingBefore} →`));
});

test("hủy đơn yêu cầu đăng nhập", async () => {
  const response = await anonymous("/api/invoices/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoiceId: "abc", reason: "thử" }),
  });
  assert.equal(response.status, 401);
});

/* ------------------------------------------------------------------ */
/* Xuất Excel                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tải file rồi mở lại bằng SheetJS — thư viện khác với mã tự viết đã sinh ra
 * nó. Chỉ kiểm tra vài byte đầu thì không chứng minh được Excel mở lên đọc ra
 * đúng dữ liệu.
 */
async function downloadWorkbook(pathname) {
  const response = await authed(pathname);
  assert.equal(response.status, 200, `tải ${pathname} thất bại`);
  assert.match(
    response.headers.get("content-type") ?? "",
    /spreadsheetml\.sheet/,
    "sai kiểu nội dung, trình duyệt sẽ không tải về",
  );
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /attachment; filename=".+\.xlsx"/,
    "thiếu tên file đính kèm",
  );

  const bytes = new Uint8Array(await response.arrayBuffer());
  // "PK" — chữ ký của kho ZIP, mà xlsx chính là ZIP.
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);

  return XLSX.read(bytes, { type: "array" });
}

/** Đọc một sheet thành mảng hai chiều, giữ nguyên ô trống. */
function sheetRows(workbook, index = 0) {
  const sheet = workbook.Sheets[workbook.SheetNames[index]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}

test("xuất danh sách khách thuê ra file Excel mở được", async () => {
  const workbook = await downloadWorkbook("/api/export/tenants");
  assert.deepEqual(workbook.SheetNames, ["Khách thuê"]);

  const rows = sheetRows(workbook);
  assert.deepEqual(rows[0], [
    "Mã khách",
    "Họ và tên",
    "Số điện thoại",
    "Phòng",
    "Nhà",
    "Từ ngày",
    "Đến ngày",
    "Tiền thuê",
    "Công nợ",
    "Trạng thái",
  ]);

  const { tenants } = await (await authed("/api/tenants")).json();
  assert.equal(rows.length - 1, tenants.length, "số dòng không khớp danh sách thật");

  const first = tenants[0];
  const row = rows.find((item) => item[0] === first.code);
  assert.ok(row, `không thấy dòng của ${first.code}`);
  assert.equal(row[1], first.fullName, "tên tiếng Việt bị hỏng khi xuất");

  // Số điện thoại phải là chuỗi, nếu để số Excel sẽ cắt mất số 0 đứng đầu.
  assert.equal(typeof row[2], "string");
  assert.match(row[2], /^0\d+$/);

  // Tiền phải là số để cộng được trong Excel, không phải chuỗi đã định dạng.
  assert.equal(typeof row[7], "number");
  assert.equal(row[7], first.rent);
  assert.equal(row[8], first.debt);
});

test("xuất đơn thu tách đúng từng khoản tiền", async () => {
  const period = new Date().toISOString().slice(0, 7);
  const workbook = await downloadWorkbook(`/api/export/invoices?period=${period}`);

  const rows = sheetRows(workbook);
  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  assert.equal(rows.length - 1, invoices.length);

  const target = invoices.find((invoice) => invoice.status !== "cancelled");
  const row = rows.find((item) => item[0] === target.code);
  assert.ok(row, `không thấy đơn ${target.code}`);

  const amountOf = (kind) =>
    target.items.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amount, 0);

  assert.equal(row[6], amountOf("rent"), "tiền phòng sai");
  assert.equal(row[7], amountOf("electricity"), "tiền điện sai");
  assert.equal(row[8], amountOf("water"), "tiền nước sai");
  assert.equal(row[9], amountOf("service"), "phí dịch vụ sai");
  assert.equal(row[10], target.total);

  // Các khoản cộng lại phải bằng tổng đơn, nếu không là xuất thiếu dòng nào đó.
  assert.equal(row[6] + row[7] + row[8] + row[9], row[10]);
});

test("xuất thu chi có sheet cơ cấu chi và dòng tổng", async () => {
  const period = new Date().toISOString().slice(0, 7);
  const workbook = await downloadWorkbook(`/api/export/cashflow?period=${period}`);

  assert.equal(workbook.SheetNames.length, 2);
  assert.match(workbook.SheetNames[0], /Thu chi/);
  assert.equal(workbook.SheetNames[1], "Cơ cấu chi");

  const rows = sheetRows(workbook);
  const totalRow = rows.find((row) => row[3] === "TỔNG");
  assert.ok(totalRow, "thiếu dòng tổng");

  // Dòng tổng phải khớp tổng các giao dịch trong kỳ, không phải số bịa.
  const body = rows.slice(1).filter((row) => row[0] && String(row[0]).startsWith("GD-"));
  const income = body.reduce((sum, row) => sum + (row[6] ?? 0), 0);
  const expense = body.reduce((sum, row) => sum + (row[7] ?? 0), 0);
  assert.equal(totalRow[6], income, "tổng thu không khớp các dòng");
  assert.equal(totalRow[7], expense, "tổng chi không khớp các dòng");

  const netRow = rows.find((row) => row[3] === "DÒNG TIỀN THUẦN");
  assert.equal(netRow[6], income - expense);

  const breakdown = sheetRows(workbook, 1);
  assert.deepEqual(breakdown[0], ["Nhóm chi", "Số tiền", "Tỷ trọng"]);
  assert.ok(breakdown.length > 1, "sheet cơ cấu chi trống");
});

test("mọi ô tiền trong file xuất đều là số, cộng được trong Excel", async () => {
  const period = new Date().toISOString().slice(0, 7);
  const workbook = await downloadWorkbook(`/api/export/invoices?period=${period}`);
  const rows = sheetRows(workbook);

  for (const row of rows.slice(1)) {
    for (const column of [6, 7, 8, 9, 10, 11, 12]) {
      assert.equal(
        typeof row[column],
        "number",
        `cột ${column} của đơn ${row[0]} không phải số`,
      );
    }
  }
});

test("tên file tải về đọc được, bản xuất theo kỳ không lặp hai ngày", async () => {
  const period = new Date().toISOString().slice(0, 7);
  const nameOf = async (pathname) =>
    (await authed(pathname)).headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1];

  assert.equal(await nameOf(`/api/export/invoices?period=${period}`), `don-thu-${period}.xlsx`);
  assert.equal(await nameOf(`/api/export/cashflow?period=${period}`), `thu-chi-${period}.xlsx`);

  // Bản chụp danh sách thì gắn ngày để phân biệt các lần xuất.
  assert.match(await nameOf("/api/export/tenants"), /^khach-thue-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("xuất Excel yêu cầu đăng nhập", async () => {
  for (const pathname of [
    "/api/export/tenants",
    "/api/export/invoices",
    "/api/export/cashflow",
  ]) {
    assert.equal((await anonymous(pathname)).status, 401, pathname);
  }
});

/* ------------------------------------------------------------------ */
/* Nhắc nợ tự động                                                    */
/* ------------------------------------------------------------------ */

/** Chạy vòng rà với một ngày giả lập, để kiểm tra từng mốc nhắc. */
async function runReminders(today) {
  const response = await json("/api/reminders", today ? { today } : {});
  assert.equal(response.status, 200, "rà nhắc nợ thất bại");
  return response.json();
}

async function pendingReminders() {
  const { reminders } = await (await authed("/api/reminders")).json();
  return reminders;
}

/** Đơn còn nợ bất kỳ, kèm hạn thanh toán, để tính ngày giả lập quanh nó. */
async function anyUnpaidInvoice() {
  const period = new Date().toISOString().slice(0, 7);
  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const invoice = invoices.find(
    (row) => row.outstanding > 0 && row.status !== "cancelled",
  );
  assert.ok(invoice, "dữ liệu mẫu phải có đơn còn nợ");
  return invoice;
}

/** Cộng/trừ ngày cho một chuỗi `YYYY-MM-DD`. */
function shiftDate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("đúng ngày đến hạn thì sinh lời nhắc mốc đến hạn", async () => {
  const invoice = await anyUnpaidInvoice();
  const result = await runReminders(invoice.dueDate);
  assert.ok(result.created > 0, "không sinh lời nhắc nào");

  const list = await pendingReminders();
  const reminder = list.find((item) => item.invoiceCode === invoice.code);
  assert.ok(reminder, `không thấy lời nhắc cho ${invoice.code}`);
  assert.equal(reminder.kind, "due");
  assert.equal(reminder.kindLabel, "Đến hạn hôm nay");
  assert.equal(reminder.amount, invoice.outstanding, "số tiền nhắc phải là phần còn nợ");

  // Nội dung phải có đủ thông tin khách cần để đối chiếu.
  assert.match(reminder.message, new RegExp(reminder.tenantName));
  assert.match(reminder.message, new RegExp(reminder.roomCode));
  assert.match(reminder.message, /hôm nay là hạn thanh toán/i);
});

test("rà lại trong cùng ngày không tạo lời nhắc trùng", async () => {
  const invoice = await anyUnpaidInvoice();
  const before = (await pendingReminders()).length;

  const again = await runReminders(invoice.dueDate);
  assert.equal(again.created, 0, "tạo thêm lời nhắc trùng trong cùng ngày");
  assert.ok(again.skipped > 0);

  assert.equal((await pendingReminders()).length, before);
});

test("trước hạn trong ngưỡng thì nhắc, ngoài ngưỡng thì thôi", async () => {
  const invoice = await anyUnpaidInvoice();

  // Mặc định nhắc trước 3 ngày. Cách 10 ngày thì chưa tới lượt.
  const early = await runReminders(shiftDate(invoice.dueDate, -10));
  const list = await pendingReminders();
  assert.ok(
    !list.some(
      (item) => item.invoiceCode === invoice.code && item.scheduledFor === shiftDate(invoice.dueDate, -10),
    ),
    "nhắc quá sớm so với ngưỡng",
  );
  assert.ok(early.created >= 0);

  // Cách 2 ngày thì trong ngưỡng.
  const soon = shiftDate(invoice.dueDate, -2);
  await runReminders(soon);
  const after = await pendingReminders();
  const reminder = after.find(
    (item) => item.invoiceCode === invoice.code && item.scheduledFor === soon,
  );
  assert.ok(reminder, "không nhắc dù đã trong ngưỡng trước hạn");
  assert.equal(reminder.kind, "before_due");
  assert.match(reminder.message, /còn 2 ngày/);
});

test("quá hạn thì nhắc lại theo chu kỳ chứ không nhắc mỗi ngày", async () => {
  const invoice = await anyUnpaidInvoice();

  // Chu kỳ mặc định 3 ngày: quá hạn 3 và 6 ngày thì nhắc, 4 và 5 thì không.
  const results = {};
  for (const late of [3, 4, 5, 6]) {
    const day = shiftDate(invoice.dueDate, late);
    await runReminders(day);
    const list = await pendingReminders();
    results[late] = list.some(
      (item) => item.invoiceCode === invoice.code && item.scheduledFor === day,
    );
  }

  assert.equal(results[3], true, "quá hạn 3 ngày phải nhắc");
  assert.equal(results[4], false, "nhắc dồn dập mỗi ngày");
  assert.equal(results[5], false, "nhắc dồn dập mỗi ngày");
  assert.equal(results[6], true, "quá hạn 6 ngày phải nhắc lại");
});

test("nội dung nhắc quá hạn nói rõ số ngày trễ", async () => {
  const invoice = await anyUnpaidInvoice();
  const list = await pendingReminders();
  const overdue = list.find(
    (item) => item.invoiceCode === invoice.code && item.kind === "overdue",
  );
  assert.ok(overdue, "chưa có lời nhắc quá hạn nào");
  assert.match(overdue.message, /đã quá hạn \d+ ngày/);
  assert.match(overdue.message, /nếu đã chuyển khoản rồi/i);
});

test("đơn đã thu đủ thì không bị nhắc", async () => {
  const period = new Date().toISOString().slice(0, 7);
  const { invoices } = await (await authed(`/api/invoices?period=${period}`)).json();
  const paid = invoices.find((row) => row.status === "paid");
  assert.ok(paid, "dữ liệu mẫu phải có đơn đã thu đủ");

  await runReminders(paid.dueDate);
  const list = await pendingReminders();
  assert.ok(
    !list.some((item) => item.invoiceCode === paid.code),
    "nhắc nợ cả đơn đã thu đủ",
  );
});

test("đánh dấu đã nhắc thì rời khỏi danh sách chờ", async () => {
  const list = await pendingReminders();
  const target = list[0];
  assert.ok(target, "cần ít nhất một lời nhắc để thử");

  const marked = await json("/api/reminders", { id: target.id, channel: "zalo" }, "PATCH");
  assert.equal(marked.status, 200);

  const after = await pendingReminders();
  assert.ok(!after.some((item) => item.id === target.id), "vẫn còn trong danh sách chờ");

  // Nhưng phải lưu lại để sau còn đối chiếu.
  const { reminders: all } = await (await authed("/api/reminders?includeSent=true")).json();
  const stored = all.find((item) => item.id === target.id);
  assert.ok(stored, "lời nhắc bị xóa thay vì lưu lại");
  assert.equal(stored.channel, "zalo");
  assert.ok(stored.sentAt);
});

test("không đánh dấu hai lần cùng một lời nhắc", async () => {
  const { reminders: all } = await (await authed("/api/reminders?includeSent=true")).json();
  const sent = all.find((item) => item.sentAt);

  const again = await json("/api/reminders", { id: sent.id, channel: "sms" }, "PATCH");
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /đã đánh dấu rồi/);
});

test("từ chối kênh nhắc lạ", async () => {
  const list = await pendingReminders();
  const target = list[0];
  assert.ok(target);

  const response = await json("/api/reminders", { id: target.id, channel: "bo-cau" }, "PATCH");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Kênh nhắc không hợp lệ/);
});

test("trang Nhắc nợ kết xuất được và số liệu vào Tổng quan", async () => {
  const page = await authed("/nhac-no");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Nhắc nợ/);

  const pending = await pendingReminders();
  const dashboard = await (await authed("/")).text();
  if (pending.length > 0) {
    // React chèn `<!-- -->` giữa biểu thức và chữ liền kề khi kết xuất.
    assert.match(dashboard, new RegExp(`${pending.length}<!-- --> lời nhắc nợ chờ gửi`));
  }
});

test("nhắc nợ yêu cầu đăng nhập", async () => {
  assert.equal((await anonymous("/api/reminders")).status, 401);
  assert.equal(
    (await anonymous("/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).status,
    401,
  );
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
  const unpaid = invoices.find(
    (invoice) => invoice.outstanding > 0 && invoice.status !== "cancelled",
  );
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
  // Nói rõ "đã thu đủ": đơn đã hủy cũng có còn nợ bằng 0 nhưng lỗi khác.
  const settled = invoices.find((invoice) => invoice.status === "paid");
  assert.ok(settled, "dữ liệu mẫu phải có đơn đã thu đủ");

  const response = await json("/api/payments", { invoiceId: settled.id, amount: 1000 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /đã thu đủ/);
});

test("từ chối thanh toán lớn hơn phần còn nợ", async () => {
  const { invoices } = await (await authed("/api/invoices")).json();
  const unpaid = invoices.find(
    (invoice) => invoice.outstanding > 0 && invoice.status !== "cancelled",
  );

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
  // Lấy cả sổ chứ không phải 30 dòng mặc định, nếu không phép cộng bị cắt cụt.
  const before = await (await authed("/api/ledger?limit=1000")).json();
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

  const after = await (await authed("/api/ledger?limit=1000")).json();
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

test("hai yêu cầu đồng thời không tạo được hai hợp đồng trên cùng một phòng", async () => {
  // Mã ứng dụng kiểm phòng còn trống trước khi ký, nhưng kiểm rồi mới ghi là
  // còn cửa sổ cho hai yêu cầu cùng lọt.
  //
  // Bài này canh HÀNH VI — chỉ một hợp đồng được tạo — chứ chưa chứng minh
  // được cơ chế nào chặn. Đã thử gỡ index `contracts_room_active_unq` rồi
  // chạy lại: vẫn xanh, nên ở môi trường kiểm thử này D1 tuần tự hóa đủ để
  // hai yêu cầu không thật sự chạm nhau. Index vẫn giữ vì nó là lớp chặn duy
  // nhất không có cửa sổ, nhưng muốn chứng minh nó thì cần chèn thẳng hàng
  // thứ hai vào cơ sở dữ liệu, không đi qua HTTP.
  //
  // Đặt cuối file vì nó ký một hợp đồng mới, làm lệch số phòng trống mà các
  // bài phía trên trông vào.
  // Tự dựng phòng riêng thay vì trông vào phòng trống còn sót: các bài phía
  // trên đã ký hết hợp đồng, mà bài này nói về ràng buộc cạnh tranh chứ không
  // nên phụ thuộc thứ tự chạy.
  const { properties } = await (await authed("/api/properties")).json();
  const nha = properties[0];
  const loai = await json("/api/room-types", {
    propertyId: nha.id,
    code: "CTR",
    name: "Phòng thử cạnh tranh",
    basePrice: 2500000,
    defaultDeposit: 2500000,
    maxOccupants: 2,
  });
  assert.equal(loai.status, 201);

  const taoPhong = await json("/api/rooms", {
    propertyId: nha.id,
    roomTypeId: (await loai.json()).roomType.id,
    number: "CTR-01",
    floor: 1,
    price: 2500000,
    area: 18,
  });
  assert.equal(taoPhong.status, 201);
  const trong = (await taoPhong.json()).room;

  const hopDong = (ten, sdt) =>
    json("/api/tenants", {
      fullName: ten,
      phone: sdt,
      roomId: trong.id,
      startDate: new Date().toISOString().slice(0, 10),
    });

  const ketQua = await Promise.all([
    hopDong("Người Thuê Thứ Nhất", "0911000001"),
    hopDong("Người Thuê Thứ Hai", "0911000002"),
  ]);

  const thanhCong = ketQua.filter((r) => r.status === 201);
  assert.equal(thanhCong.length, 1, "chỉ một trong hai yêu cầu được phép thành công");

  // Và cơ sở dữ liệu phải đúng một hợp đồng còn hiệu lực cho phòng đó.
  const sau = await (await authed("/api/rooms")).json();
  const phong = sau.rooms.find((r) => r.id === trong.id);
  assert.equal(phong.status, "Đang thuê");
});

/* ------------------------------------------------------------------ */
/* Thao tác song song và mã tuần tự                                   */
/* ------------------------------------------------------------------ */

test("hai lần thu song song cho cùng một đơn chỉ ghi nhận một lần", async () => {
  const { invoices } = await (await authed("/api/invoices")).json();
  const unpaid = invoices.find(
    (invoice) => invoice.outstanding > 0 && invoice.status !== "cancelled",
  );
  assert.ok(unpaid, "cần một đơn còn nợ");

  const before = await (await authed("/api/ledger?limit=1000")).json();

  // Mô phỏng bấm đúp: hai yêu cầu cùng thu hết phần còn nợ.
  const body = { invoiceId: unpaid.id, amount: unpaid.outstanding };
  const responses = await Promise.all([json("/api/payments", body), json("/api/payments", body)]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 400], "phải đúng một lần thành công");

  const after = await (await authed("/api/invoices")).json();
  const updated = after.invoices.find((invoice) => invoice.id === unpaid.id);
  assert.equal(updated.outstanding, 0);
  assert.equal(updated.status, "paid");

  // Sổ quỹ chỉ được có thêm đúng một dòng thu cho đơn này.
  const ledger = await (await authed("/api/ledger?limit=1000")).json();
  const created = ledger.entries.filter(
    (entry) => !before.entries.some((old) => old.id === entry.id),
  );
  assert.equal(created.length, 1, "sổ quỹ ghi thừa khoản thu");
  assert.equal(created[0].amount, unpaid.outstanding);
});

test("mã tuần tự vẫn tăng đúng sau dòng thứ 999", async () => {
  // So mã theo chuỗi thì "DP-999" > "DP-1000": từ đây mọi lần tạo đều trùng mã.
  const db = await mf.getD1Database("DB");
  for (const code of ["DP-999", "DP-1000"]) {
    await db
      .prepare("INSERT INTO booking_requests (id, code, full_name, phone) VALUES (?, ?, ?, ?)")
      .bind(`bkg_test_${code}`, code, "Khách Mã Lớn", "0905550041")
      .run();
  }

  for (const name of ["Khách Sau Một Nghìn A", "Khách Sau Một Nghìn B"]) {
    const response = await anonymous("/api/booking-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: name, phone: "0905550042" }),
    });
    assert.equal(response.status, 201, `${name} không gửi được`);
  }

  const { results } = await db
    .prepare("SELECT code FROM booking_requests WHERE full_name LIKE 'Khách Sau Một Nghìn %' ORDER BY code")
    .all();
  assert.deepEqual(results.map((row) => row.code), ["DP-1001", "DP-1002"]);
});

test("biểu mẫu đặt phòng chặn một IP gửi dồn dập, không ảnh hưởng đăng nhập", async () => {
  const send = () =>
    anonymous("/api/booking-requests", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" },
      // Số điện thoại sai để không tạo dòng nào; lượt gửi vẫn bị đếm.
      body: JSON.stringify({ fullName: "Kẻ Gửi Dồn", phone: "abc" }),
    });

  for (let index = 0; index < 10; index += 1) {
    assert.equal((await send()).status, 400, `lượt ${index + 1} phải tới được bước kiểm dữ liệu`);
  }

  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  // Lượt gửi form không được tính thành đăng nhập sai của IP đó.
  const login = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" },
    body: JSON.stringify({ email: "khong-ton-tai@example.com", password: "sai-mat-khau" }),
  });
  assert.equal(login.status, 401);
});
