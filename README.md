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
- Tên miền và môi trường chạy thật do người triển khai tự cấu hình. Hướng dẫn đưa lên Cloudflare có ở [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md).

## Chạy tại máy

Yêu cầu Node.js `>=22.18.0`.

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

### Chạy như một server (mở cho điện thoại trong cùng wifi)

`npm run dev` **không được dùng làm server**: ở chế độ dev, `import.meta.env.DEV`
là true nên nhóm route `/api/dev/` mở — mở ra mạng nội bộ nghĩa là ai trong cùng
wifi cũng xoá sạch được cơ sở dữ liệu mà không cần đăng nhập.

```bash
npm run server:khoi-tao   # lần đầu: tạo cơ sở dữ liệu trống + tài khoản chủ nhà
npm start                 # chạy server
```

Trên Windows thì nhấp đúp `chay-server.bat` (tự build rồi chạy).

Chạy bản build production trên Miniflare 4 — đúng runtime của bộ kiểm thử
— bind `0.0.0.0`, dữ liệu ở `.wrangler/state/server` tách khỏi cơ sở dữ liệu
mẫu của `npm run dev`. Nhóm route `/api/dev/` bị khoá; chế độ `--khoi-tao` có
mở nó nhưng khi ấy Miniflare không mở cổng mạng, mọi lời gọi đi qua
`dispatchFetch` trong tiến trình.

Xác nhận bằng:

```bash
npm run kiem-tra-deploy -- http://localhost:3000
```

Mạng nội bộ không có HTTPS nên mật khẩu đi qua wifi ở dạng chữ thường. Lệnh
kiểm tra ghi rõ điều này nhưng không coi là lỗi chặn khi địa chỉ nằm trong dải
IP riêng.

### Dùng thật

Bắt đầu bằng cơ sở dữ liệu **trống**, không có dữ liệu mẫu và không có tài khoản mẫu. Dữ liệu thật nằm ở `.wrangler/state/server`, tách hẳn khỏi cơ sở dữ liệu mẫu mà `start.bat` và `npm run dev` dùng.

1. Nhấp đúp `khoi-tao-that.bat` (hoặc `npm run server:khoi-tao`). **Không cần** server đang chạy — nên tắt nó đi. File này tạo cơ sở dữ liệu trống, rồi hỏi email, họ tên và mật khẩu để tạo tài khoản chủ nhà đầu tiên.
2. Nhấp đúp `chay-server.bat` để chạy hằng ngày.

Chạy `khoi-tao-that.bat` lần thứ hai thì nó **dừng lại** nếu cơ sở dữ liệu đã có tài khoản, để không ai xóa nhầm số liệu thật. Muốn xóa hết làm lại từ đầu phải gõ rõ:

```bash
node scripts/chay-server.mjs --khoi-tao --xoa-du-lieu-cu
```

Lệnh đó sao lưu dữ liệu cũ sang thư mục bên cạnh (`.wrangler/state/server-sao-luu-...`) rồi mới xóa.

Từ tài khoản thứ hai trở đi thì tạo ở trang **Tài khoản**. Sau khi đăng nhập lần đầu: bật **xác thực hai bước** và tạo thêm **một tài khoản chủ nhà thứ hai** để phòng khi quên mật khẩu.

**Đừng** nhập dữ liệu thật vào bản chạy bằng `start.bat` hay `npm run dev`: ở đó nhóm route `/api/dev/` đang mở, và `reset-data.bat` / `npm run db:reset` xóa sạch rồi nạp lại dữ liệu mẫu. Hai lệnh đó không đụng tới `.wrangler/state/server`, nên với dữ liệu thật của chế độ server thì chúng vô hại.

Trên Cloudflare thì khác — dùng `npm run create-owner`, xem [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md). Đừng dùng lệnh `wrangler d1 execute --local` mà script đó in ra cho chế độ server ở máy: wrangler ghi vào một file SQLite khác với file server đang dùng, lệnh báo thành công nhưng tài khoản không xuất hiện.

#### Cập nhật bản mới

Tải mã nguồn mới về đè lên thư mục cũ (giữ nguyên `.wrangler/`), rồi chạy `chay-server.bat` như thường. Nếu bản mới có thay đổi cấu trúc dữ liệu, server tự sao lưu thư mục dữ liệu sang `.wrangler/state/server-sao-luu-...` rồi mới cập nhật, trước khi mở cổng.

#### Sao lưu

Thư mục cần sao lưu là `.wrangler/state/server`. Tắt server, chép nguyên thư mục đó sang ổ khác hoặc lên đám mây. Chạy trên máy local không có sao lưu tự động hằng ngày, không có HTTPS, và máy tắt là mất truy cập; dùng lâu dài thì cân nhắc đưa lên Cloudflare — xem [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md).

Route `/api/dev/setup` mặc định bị khóa ngoài môi trường dev; bản build production chỉ mở khi khai báo `ALLOW_DEV_SETUP=true` — đừng bao giờ đặt biến đó trên bản chạy thật.

## Kiểm tra

```bash
npm test
```

Chạy typecheck, build, rồi kiểm thử bản build trong Miniflare (workerd thật kèm D1 thật): hơn 150 bài, gồm xác thực, quyền truy cập, ràng buộc nghiệp vụ và kiểm tra trang công khai không lộ dữ liệu khách thuê.

```bash
npm run lint
```

Mọi push và pull request vào `main` chạy lại đúng những lệnh này trên GitHub
Actions, xem [.github/workflows/ci.yml](.github/workflows/ci.yml). Ngoài
typecheck/build/lint/test, CI còn chặn hai thứ: cây phụ thuộc production có
cảnh báo, và file cấu hình khai báo `ALLOW_DEV_SETUP` — biến mở đường xoá sạch
cơ sở dữ liệu. Cây dev/build hiện còn 14 cảnh báo, được ghi ra nhưng không chặn
vì không có đường chạm tới runtime.

## Quên mật khẩu

Hệ thống **không gửi email**: Cloudflare Workers không mở được kết nối TCP nên không dùng SMTP trực tiếp, và chưa cấu hình dịch vụ gửi mail nào.

Người quên mật khẩu báo chủ nhà. Chủ nhà vào trang **Tài khoản**, bấm *Link quên mật khẩu* ở dòng của người đó, rồi gửi link qua Zalo hoặc đọc qua điện thoại. Link sống một giờ, dùng được một lần, và khi đặt lại xong mọi thiết bị đang đăng nhập tài khoản đó bị đăng xuất.

Link không tự đăng nhập — đặt xong vẫn phải đăng nhập bình thường, nên tài khoản có bật xác thực hai bước vẫn bị hỏi mã.

### Khi chủ nhà duy nhất quên mật khẩu

Lúc đó không ai cấp được link, phải sửa thẳng cơ sở dữ liệu:

Bản chạy trên máy (`chay-server.bat`): tắt server rồi chạy lệnh dưới, nó hỏi tên đăng nhập và mật khẩu mới, ghi thẳng vào đúng cơ sở dữ liệu server đang dùng và đăng xuất mọi thiết bị cũ.

```bash
node scripts/chay-server.mjs --dat-lai-mat-khau
```

Bản trên Cloudflare:

```bash
npm run hash-password "mat khau moi cua ban" "email-tai-khoan"
```

Script ghi câu lệnh SQL vào file `dat-lai-mat-khau.sql` rồi in ra lệnh `wrangler d1 execute --file` để chạy. Nó dùng chung module băm với máy chủ nên định dạng chắc chắn khớp — có bài kiểm thử đối chiếu giữa Node và workerd. Chạy xong thì xóa file đó, đăng nhập lại và đổi mật khẩu ở trang Cài đặt.

Cách phòng tránh tốt hơn: **luôn có ít nhất hai tài khoản chủ nhà**, để người này cấp link cho người kia.

## Đổi schema

```bash
npm run db:generate
```

Sinh migration mới vào `drizzle/`. Trên Cloudflare, áp lên D1 thật bằng `npm run deploy:migrate`; ở chế độ server trên máy, `chay-server` tự áp lúc khởi động (sao lưu trước); còn `npm run dev` thì `npm run db:setup` lo việc đó.

## Cấu trúc

| Thư mục | Vai trò |
|---|---|
| `app/` | Trang (server component) + client component tương ứng, API route trong `app/api/` |
| `db/schema.ts` | 22 bảng Drizzle |
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

- [Hướng dẫn cài đặt cho khách hàng](docs/HUONG-DAN-CAI-DAT.md) — gửi kèm khi bàn giao, viết cho người không rành kỹ thuật
- [Đóng gói và bàn giao](docs/BAN-GIAO.md) — cách tạo gói sạch, những gì không được lọt vào
- [Định hướng sản phẩm](docs/PRODUCT-SCOPE.md)
- [Mô hình dữ liệu](docs/DATA-MODEL.md)
- [Đưa lên Cloudflare](docs/DEPLOY-CLOUDFLARE.md) — hướng dẫn cho nền tảng đang dùng
- [Triển khai trên VPS](docs/DEPLOYMENT.md) — kế hoạch cho phương án PostgreSQL, chưa áp dụng
- [Thông tin ảnh chia sẻ](docs/BRAND-ASSET.md)

## Nguồn mã

Repository: <https://github.com/2ez4gcx/RoomManager>.

Tài khoản `quanly@hoangan.vn`/`roommanager` trong `db/seed.ts` là dữ liệu mẫu, được công khai có chủ đích: bộ kiểm thử tự động dựng trên nó. Nó chỉ mở được cơ sở dữ liệu mẫu của người tự chạy trên máy họ và không bao giờ được nạp vào cơ sở dữ liệu thật. Mọi tên, số điện thoại, địa chỉ trong dữ liệu mẫu đều là giả.

Trước khi đưa lên môi trường thật:

- Khởi tạo cơ sở dữ liệu thật bằng đường **trống** (xem mục "Dùng thật"), không chạy `db:setup`.
- Kiểm tra tài khoản mẫu không đăng nhập được trên môi trường thật.
- Không commit `.env` (đang nằm trong `.gitignore`).
- Đảm bảo `ALLOW_DEV_SETUP` không được đặt trên môi trường thật — biến này mở route xóa sạch cơ sở dữ liệu.

## Trách nhiệm khi sử dụng

Phần mềm được chia sẻ nguyên trạng, **không kèm bảo hành nào** (xem giấy phép). Trước khi nhập dữ liệu thật, cần biết:

- **Bạn là người chịu trách nhiệm về dữ liệu cá nhân của khách thuê** (họ tên, số điện thoại, số CCCD, công nợ) theo quy định về bảo vệ dữ liệu cá nhân của Việt Nam: chỉ thu thập khi khách đồng ý, giới hạn người được xem, xóa khi không còn cần, và tự lo sao lưu.
- **Đây là sổ theo dõi, không phải phần mềm kế toán**, không xuất hóa đơn điện tử, không khai thuế, không đăng ký tạm trú. Phần mềm không đụng tới tiền thật: nó chỉ ghi lại con số bạn nhập.
- **Luôn đối chiếu con số** với sổ sách của bạn, nhất là tiền điện nước và tiền cọc. Tác giả không chịu trách nhiệm về mất dữ liệu hay số liệu sai.
- **Chế độ mạng nội bộ không có HTTPS**: mật khẩu đi qua wifi ở dạng chữ thường. Chỉ dùng trong mạng bạn tin tưởng.
- Tài khoản mẫu `quanly@hoangan.vn` / `roommanager` có mật khẩu công khai. Không bao giờ để nó tồn tại trên bản chạy với dữ liệu thật.

## Báo lỗi bảo mật

Xem [SECURITY.md](SECURITY.md).

## Giấy phép

[MIT](LICENSE).
