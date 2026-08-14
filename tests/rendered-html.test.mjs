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

test("đăng nhập được bằng tên đăng nhập ngắn, không bắt buộc là email", async () => {
  // Phụ thuộc tài khoản chạy thử trong db/seed.ts. Khi xóa tài khoản đó trước
  // lúc đưa lên môi trường thật thì xóa luôn bài kiểm thử này.
  const response = await anonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "TEST", password: "test" }),
  });

  assert.equal(response.status, 200, "chữ hoa/thường phải được chuẩn hóa");
  assert.equal((await response.json()).user.role, "owner");
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

  const { secret, otpauthUri } = await begin.json();
  assert.match(secret, /^[A-Z2-7]{32}$/, "khóa phải là base32 32 ký tự");
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);
  assert.match(otpauthUri, /issuer=RoomManager/);

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
