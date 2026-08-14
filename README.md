# RoomManager

Webapp quản lý nhà trọ: tình trạng phòng, khách thuê, hợp đồng, đơn thu, phụ thu, công nợ, thu chi và yêu cầu đặt phòng online.

## Trạng thái hiện tại

Toàn bộ giao diện đã chạy trên dữ liệu thật, có đăng nhập.

- **Đăng nhập** bằng email hoặc tên đăng nhập + mật khẩu (PBKDF2, phiên lưu cookie `HttpOnly`), có giới hạn số lần nhập sai và xác thực hai bước TOTP tùy chọn. Mọi trang và API quản trị đều bị khóa; chỉ `/booking` và `/login` là công khai.
- **Nhà & phòng** — thêm nhà mới, thêm loại phòng, thêm phòng. Trạng thái phòng được **suy ra** từ hợp đồng, giữ chỗ và bảo trì, không lưu cờ riêng.
- **Khách thuê** — tạo hồ sơ và hợp đồng cùng lúc, theo dõi công nợ và hạn hợp đồng.
- **Đặt phòng** — bảng kanban 4 trạng thái, xác nhận là giữ chỗ có hạn.
- **Đơn thu** — xem chi tiết từng dòng (tiền phòng, điện, nước, dịch vụ), ghi nhận thanh toán một phần hoặc toàn phần, lọc theo kỳ.
- **Thu chi** — sổ thu chi, biểu đồ 6 tháng, cơ cấu chi; thanh toán tự sinh dòng thu.
- **Cài đặt** — bảng giá điện/nước/dịch vụ, chu kỳ thu, thời gian giữ phòng, đổi mật khẩu, bật/tắt xác thực hai bước.
- **Tài khoản** (chỉ chủ nhà) — tạo tài khoản nhân viên, đổi vai trò, khóa/mở khóa, đặt lại mật khẩu, cấp link quên mật khẩu.
- **Trang công khai** `/booking` — hiện phòng còn trống theo thời gian thực, khách gửi yêu cầu xem phòng.

Các ràng buộc nghiệp vụ đang được kiểm thử tự động: không hai hợp đồng trên một phòng, không hai người giữ cùng một phòng, không cho thuê phòng bảo trì, không thu vượt số còn nợ, ký hợp đồng thì giải phóng chỗ giữ, và hệ thống luôn còn ít nhất một chủ nhà đăng nhập được.

**Phân quyền:** nhân viên xem và nhập được dữ liệu vận hành (phòng, khách thuê, đơn thu, thu chi, đặt phòng) nhưng không thêm nhà, không sửa bảng giá và không quản lý tài khoản.

**Chưa làm:**

- Chưa lập đơn thu tự động theo kỳ; đơn hiện do dữ liệu mẫu tạo ra.
- Nút "Xuất Excel", "Xuất báo cáo", "Gửi nhắc" mới là giao diện, chưa hoạt động.
- Chưa chốt nền tảng lâu dài: đang chạy Cloudflare D1, phương án VPS/PostgreSQL vẫn để ngỏ.
- Chưa cấu hình tên miền hay môi trường chạy thật; mới chạy ở máy local.

## Chạy tại máy

Yêu cầu Node.js `>=22.13.0`.

### Cách nhanh (Windows)

Nhấp đúp `start.bat`. File này tự kiểm tra Node.js, cài thư viện lần đầu, khởi động server, dựng bảng và nạp dữ liệu mẫu nếu cơ sở dữ liệu còn trống, rồi mở trình duyệt. Đóng cửa sổ đen để dừng server.

Muốn xoá sạch và nạp lại dữ liệu mẫu: nhấp đúp `reset-data.bat` (phải chạy `start.bat` trước, và gõ `xoa` để xác nhận).

### Cách thủ công

```bash
npm install
npm run dev
```

Lần đầu chạy, dựng bảng và nạp dữ liệu mẫu (2 nhà, 40 phòng, 32 hợp đồng, 32 đơn thu):

```bash
npm run db:setup
```

Mở `http://localhost:3000` và đăng nhập bằng một trong hai tài khoản mẫu:

| Đăng nhập | Mật khẩu | Vai trò |
|---|---|---|
| `test` | `test` | Chủ nhà — gõ nhanh khi chạy thử |
| `quanly@hoangan.vn` | `roommanager` | Chủ nhà |

Cả hai đều là tài khoản của **dữ liệu mẫu**, mật khẩu nằm công khai trong `db/seed.ts` và bị xoá/tạo lại mỗi lần chạy `reset-data.bat`. Phải xoá chúng và tạo tài khoản thật trước khi đưa lên Internet.

Xóa sạch và nạp lại từ đầu:

```bash
npm run db:reset
```

Route `/api/dev/setup` mặc định bị khóa ngoài môi trường dev; bản build production chỉ mở khi khai báo `ALLOW_DEV_SETUP=true`.

## Kiểm tra

```bash
npm test
```

Chạy typecheck, build, rồi kiểm thử bản build trong Miniflare (workerd thật kèm D1 thật): 79 bài, gồm xác thực, quyền truy cập, ràng buộc nghiệp vụ và kiểm tra trang công khai không lộ dữ liệu khách thuê.

```bash
npm run lint
```

## Quên mật khẩu

Hệ thống **không gửi email**: Cloudflare Workers không mở được kết nối TCP nên không dùng SMTP trực tiếp, và chưa cấu hình dịch vụ gửi mail nào.

Người quên mật khẩu báo chủ nhà. Chủ nhà vào trang **Tài khoản**, bấm *Link quên mật khẩu* ở dòng của người đó, rồi gửi link qua Zalo hoặc đọc qua điện thoại. Link sống một giờ, dùng được một lần, và khi đặt lại xong mọi thiết bị đang đăng nhập tài khoản đó bị đăng xuất.

Link không tự đăng nhập — đặt xong vẫn phải đăng nhập bình thường, nên tài khoản có bật xác thực hai bước vẫn bị hỏi mã.

### Khi chủ nhà duy nhất quên mật khẩu

Lúc đó không ai cấp được link, phải sửa thẳng cơ sở dữ liệu:

```bash
npm run hash-password "mat khau moi cua ban"
```

Script in ra chuỗi băm kèm câu lệnh `wrangler d1 execute` để dán. Nó dùng chung module băm với máy chủ nên định dạng chắc chắn khớp — có bài kiểm thử đối chiếu giữa Node và workerd. Đăng nhập lại xong nhớ đổi mật khẩu ở trang Cài đặt.

Cách phòng tránh tốt hơn: **luôn có ít nhất hai tài khoản chủ nhà**, để người này cấp link cho người kia.

## Đổi schema

```bash
npm run db:generate
```

Sinh migration mới vào `drizzle/`. Khi deploy, control plane tự áp SQL này lên D1 thật; ở máy local thì `npm run db:setup` lo việc đó.

## Cấu trúc

| Thư mục | Vai trò |
|---|---|
| `app/` | Trang (server component) + client component tương ứng, API route trong `app/api/` |
| `db/schema.ts` | 18 bảng Drizzle |
| `db/queries.ts`, `db/queries-extra.ts` | Truy vấn đọc, gồm cả suy ra trạng thái phòng |
| `db/mutations.ts`, `db/bookings.ts`, `db/finance.ts`, `db/settings.ts` | Thao tác ghi kèm kiểm tra dữ liệu |
| `db/auth.ts` | Băm mật khẩu, đổi mật khẩu và quản lý phiên |
| `db/login-throttle.ts` | Giới hạn số lần đăng nhập sai |
| `db/users.ts` | Quản lý tài khoản và phân quyền |
| `db/totp.ts`, `db/two-factor.ts`, `db/qr.ts` | Xác thực hai bước, mã khôi phục và mã QR |
| `db/password-reset.ts` | Link đặt lại mật khẩu dùng một lần |
| `db/password-hash.ts` | Băm mật khẩu, dùng chung với script cứu hộ |
| `proxy.ts` | Chặn điều hướng; xác thực thật nằm ở `requireUser()` và `requireApiUser()` |

## Tài liệu

- [Định hướng sản phẩm](docs/PRODUCT-SCOPE.md)
- [Mô hình dữ liệu](docs/DATA-MODEL.md)
- [Hướng dẫn triển khai VPS](docs/DEPLOYMENT.md) — kế hoạch cho phương án PostgreSQL, chưa áp dụng
- [Thông tin ảnh chia sẻ](docs/BRAND-ASSET.md)

## Nguồn mã

Repository riêng tư: <https://github.com/2ez4gcx/RoomManager>. Giữ ở chế độ private cho tới khi rà soát xong, vì lịch sử commit có chứa mật khẩu của tài khoản dữ liệu mẫu (`db/seed.ts`) và toàn bộ logic nghiệp vụ.

Trước khi chuyển sang public hoặc đưa lên môi trường thật:

- Tạo tài khoản chủ nhà riêng và **xoá hai tài khoản mẫu** trong `db/seed.ts`: `test`/`test` và `quanly@hoangan.vn`/`roommanager`.
- Rà lại `.env` chưa từng bị commit (đang nằm trong `.gitignore`).
- Đảm bảo `ALLOW_DEV_SETUP` không được đặt trên môi trường thật — biến này mở route xóa sạch cơ sở dữ liệu.
