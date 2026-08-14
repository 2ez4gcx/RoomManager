# RoomManager

Webapp quản lý nhà trọ: tình trạng phòng, khách thuê, hợp đồng, đơn thu, phụ thu, công nợ, thu chi và yêu cầu đặt phòng online.

## Trạng thái hiện tại

Toàn bộ giao diện đã chạy trên dữ liệu thật, có đăng nhập.

- **Đăng nhập** bằng email hoặc tên đăng nhập + mật khẩu (PBKDF2, phiên lưu cookie `HttpOnly`), có giới hạn số lần nhập sai và xác thực hai bước TOTP tùy chọn. Mọi trang và API quản trị đều bị khóa; chỉ `/booking` và `/login` là công khai.
- **Nhà & phòng** — thêm nhà mới, thêm loại phòng, thêm phòng. Trạng thái phòng được **suy ra** từ hợp đồng, giữ chỗ và bảo trì, không lưu cờ riêng.
- **Khách thuê** — tạo hồ sơ và hợp đồng cùng lúc, theo dõi công nợ và hạn hợp đồng, **trả phòng** với tất toán tiền cọc.
- **Đặt phòng** — bảng kanban 4 trạng thái, xác nhận là giữ chỗ có hạn.
- **Lập đơn thu** — chốt sổ cuối kỳ: nhập chỉ số điện từng phòng, xem tiền tính lại ngay, rồi phát hành đơn cho tất cả phòng đang thuê trong một lượt.
- **Đơn thu** — xem chi tiết từng dòng (tiền phòng, điện, nước, dịch vụ), ghi nhận thanh toán một phần hoặc toàn phần, **hủy đơn lập nhầm** rồi lập lại, lọc theo kỳ.
- **Thu chi** — sổ thu chi, biểu đồ 6 tháng, cơ cấu chi; thanh toán tự sinh dòng thu.
- **Nhắc nợ** — cron chạy 8 giờ sáng mỗi ngày, tự rà ai sắp đến hạn/đến hạn/quá hạn và soạn sẵn tin nhắn; chủ nhà gửi qua Zalo hoặc gọi điện rồi đánh dấu.
- **Xuất Excel** — danh sách khách thuê, đơn thu theo kỳ, sổ thu chi kèm cơ cấu chi. File `.xlsx` thật, mở thẳng bằng Excel; cột tiền là số nên cộng được ngay.
- **Cài đặt** — bảng giá điện/nước/dịch vụ, chu kỳ thu, thời gian giữ phòng, đổi mật khẩu, bật/tắt xác thực hai bước.
- **Tài khoản** (chỉ chủ nhà) — tạo tài khoản nhân viên, đổi vai trò, khóa/mở khóa, đặt lại mật khẩu, cấp link quên mật khẩu.
- **Trang công khai** `/booking` — hiện phòng còn trống theo thời gian thực, khách gửi yêu cầu xem phòng.

Các ràng buộc nghiệp vụ đang được kiểm thử tự động: không hai hợp đồng trên một phòng, không hai người giữ cùng một phòng, không cho thuê phòng bảo trì, không thu vượt số còn nợ, không lập trùng đơn cho cùng phòng và kỳ, hủy đơn không làm mất mốc chỉ số điện, chỉ số điện không lùi, ký hợp đồng thì giải phóng chỗ giữ, và hệ thống luôn còn ít nhất một chủ nhà đăng nhập được.

**Phân quyền:** nhân viên xem và nhập được dữ liệu vận hành (phòng, khách thuê, đơn thu, thu chi, đặt phòng) nhưng không thêm nhà, không sửa bảng giá và không quản lý tài khoản.

**Chưa làm:**

- Hệ thống soạn sẵn tin nhắc nợ nhưng **chưa tự gửi** cho khách: Zalo OA phải duyệt hồ sơ, SMS và email đều cần tài khoản dịch vụ trả phí.
- Chưa chốt nền tảng lâu dài: đang chạy Cloudflare D1, phương án VPS/PostgreSQL vẫn để ngỏ.
- Chưa cấu hình tên miền hay môi trường chạy thật; mới chạy ở máy local. Hướng dẫn đưa lên Cloudflare có ở [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md).

## Chạy tại máy

Yêu cầu Node.js `>=22.13.0`.

Có hai kiểu chạy, đừng trộn lẫn:

- **Xem thử** — nạp dữ liệu mẫu để bấm thử mọi màn hình. Tài khoản và mật khẩu nằm công khai trong mã nguồn.
- **Dùng thật** — khởi tạo trống, tự tạo tài khoản của mình rồi nhập dữ liệu nhà trọ.

### Xem thử (Windows)

Nhấp đúp `start.bat`. File này tự kiểm tra Node.js, cài thư viện lần đầu, khởi động server, dựng bảng và nạp dữ liệu mẫu nếu cơ sở dữ liệu còn trống, rồi mở trình duyệt. Đóng cửa sổ đen để dừng server.

Đăng nhập: `quanly@hoangan.vn` / `roommanager`.

Đây là tài khoản của **dữ liệu mẫu**, mật khẩu nằm công khai trong `db/seed.ts` và bị xoá/tạo lại mỗi lần nạp lại mẫu. Không bao giờ để tài khoản này tồn tại trên cơ sở dữ liệu thật.

Muốn xoá sạch và nạp lại dữ liệu mẫu: nhấp đúp `reset-data.bat` (gõ `xoa` để xác nhận).

### Xem thử (thủ công)

```bash
npm install
npm run dev
```

Dựng bảng và nạp dữ liệu mẫu — 2 nhà, 40 phòng, 32 hợp đồng, 32 đơn thu:

```bash
npm run db:setup
```

Xóa sạch và nạp lại từ đầu:

```bash
npm run db:reset
```

### Dùng thật

Bắt đầu bằng cơ sở dữ liệu **trống**, không có dữ liệu mẫu và không có tài khoản mẫu.

Trên Windows, khi server đang chạy: nhấp đúp `khoi-tao-that.bat`. File này xoá sạch cơ sở dữ liệu (gõ `dung that` để xác nhận), rồi hỏi email, họ tên và mật khẩu để tạo tài khoản chủ nhà đầu tiên.

Làm thủ công thì hai bước:

```bash
curl -X POST "http://localhost:3000/api/dev/setup?empty=true"
```

```bash
curl -X POST http://localhost:3000/api/dev/create-owner   -H "content-type: application/json"   -d "{\"email\":\"email@cua-ban.vn\",\"fullName\":\"Họ Tên\",\"password\":\"mật khẩu ít nhất 8 ký tự\"}"
```

Route `create-owner` chỉ chạy khi cơ sở dữ liệu **chưa có tài khoản nào**; từ tài khoản thứ hai trở đi thì tạo ở trang **Tài khoản**.

Trên Cloudflare thì khác — dùng `npm run create-owner`, xem [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md). Đừng chạy lệnh `wrangler d1 execute --local` mà script đó in ra: wrangler mở một file SQLite khác với file `npm run dev` đang dùng, tài khoản tạo xong sẽ không đăng nhập được.

Sau khi đăng nhập lần đầu: đổi mật khẩu ở trang **Cài đặt** (mật khẩu vừa gõ đang nằm trong lịch sử lệnh của terminal), bật **xác thực hai bước**, và tạo thêm **một tài khoản chủ nhà thứ hai** để phòng khi quên mật khẩu.

Từ lúc này, **đừng chạy `reset-data.bat` hay `npm run db:reset` nữa** — chúng xóa sạch dữ liệu thật rồi thay bằng dữ liệu mẫu, không hoàn tác được.

> **Chạy thật trên máy local là tạm bợ.** Dữ liệu nằm trong `.wrangler/state`, không có sao lưu, không có HTTPS, và máy tắt là mất truy cập. Dùng lâu dài thì đưa lên Cloudflare — xem [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md), ở đó D1 có Time Travel giữ 30 ngày.

Route `/api/dev/setup` mặc định bị khóa ngoài môi trường dev; bản build production chỉ mở khi khai báo `ALLOW_DEV_SETUP=true`.

## Kiểm tra

```bash
npm test
```

Chạy typecheck, build, rồi kiểm thử bản build trong Miniflare (workerd thật kèm D1 thật): 127 bài, gồm xác thực, quyền truy cập, ràng buộc nghiệp vụ và kiểm tra trang công khai không lộ dữ liệu khách thuê.

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
| `db/schema.ts` | 21 bảng Drizzle |
| `db/queries.ts`, `db/queries-extra.ts` | Truy vấn đọc, gồm cả suy ra trạng thái phòng |
| `db/mutations.ts`, `db/bookings.ts`, `db/finance.ts`, `db/settings.ts` | Thao tác ghi kèm kiểm tra dữ liệu |
| `db/auth.ts` | Băm mật khẩu, đổi mật khẩu và quản lý phiên |
| `db/login-throttle.ts` | Giới hạn số lần đăng nhập sai |
| `db/users.ts` | Quản lý tài khoản và phân quyền |
| `db/totp.ts`, `db/two-factor.ts`, `db/qr.ts` | Xác thực hai bước, mã khôi phục và mã QR |
| `db/billing.ts` | Lập đơn thu theo kỳ, chia tiền theo ngày |
| `db/move-out.ts` | Trả phòng và tất toán tiền cọc |
| `db/invoice-cancel.ts` | Hủy đơn thu lập nhầm |
| `db/reminders.ts` | Nhắc nợ: rà theo lịch và soạn tin |
| `db/xlsx.ts`, `db/zip.ts` | Sinh file Excel, không dùng thư viện ngoài |
| `db/password-reset.ts` | Link đặt lại mật khẩu dùng một lần |
| `db/password-hash.ts` | Băm mật khẩu, dùng chung với script cứu hộ |
| `proxy.ts` | Chặn điều hướng; xác thực thật nằm ở `requireUser()` và `requireApiUser()` |

## Tài liệu

- [Định hướng sản phẩm](docs/PRODUCT-SCOPE.md)
- [Mô hình dữ liệu](docs/DATA-MODEL.md)
- [Đưa lên Cloudflare](docs/DEPLOY-CLOUDFLARE.md) — hướng dẫn cho nền tảng đang dùng
- [Triển khai trên VPS](docs/DEPLOYMENT.md) — kế hoạch cho phương án PostgreSQL, chưa áp dụng
- [Thông tin ảnh chia sẻ](docs/BRAND-ASSET.md)

## Nguồn mã

Repository riêng tư: <https://github.com/2ez4gcx/RoomManager>. Giữ ở chế độ private cho tới khi rà soát xong, vì lịch sử commit có chứa mật khẩu của tài khoản dữ liệu mẫu và toàn bộ logic nghiệp vụ.

Tài khoản `test`/`test` đã bị xoá khỏi mã nguồn. Chỉ còn `quanly@hoangan.vn`/`roommanager` trong `db/seed.ts` — dữ liệu mẫu phải giữ lại vì bộ kiểm thử tự động dựng trên nó, nhưng nó không bao giờ được nạp vào cơ sở dữ liệu thật.

Trước khi chuyển sang public hoặc đưa lên môi trường thật:

- Khởi tạo cơ sở dữ liệu thật bằng đường **trống** (xem mục "Dùng thật"), không chạy `db:setup`.
- Kiểm tra tài khoản mẫu không đăng nhập được trên môi trường thật.
- Rà lại `.env` chưa từng bị commit (đang nằm trong `.gitignore`).
- Đảm bảo `ALLOW_DEV_SETUP` không được đặt trên môi trường thật — biến này mở route xóa sạch cơ sở dữ liệu.
- Mật khẩu `roommanager` vẫn nằm trong lịch sử commit. Nếu muốn public thì đổi mật khẩu dữ liệu mẫu là chưa đủ — phải viết lại lịch sử, hoặc chấp nhận rằng nó chỉ mở được cơ sở dữ liệu mẫu của người tự chạy máy họ.
