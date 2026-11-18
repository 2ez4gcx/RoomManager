# Vận hành RoomManager

Tài liệu cho người tự cài và trông coi một bản RoomManager: chạy như một
server, khởi tạo dữ liệu thật, cập nhật, sao lưu và xử lý khi quên mật khẩu.

Người không rành kỹ thuật nên đọc [HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md)
trước; tài liệu này đi sâu hơn và giả định bạn quen dòng lệnh. Đưa lên
Cloudflare thì xem [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

## Chạy như một server (mở cho điện thoại trong cùng wifi)

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

Không cần cho máy khác truy cập thì chạy `node scripts/chay-server.mjs --chi-may-nay`: server chỉ nhận kết nối từ chính máy này, không mở ra mạng nội bộ.

Muốn có HTTPS (ví dụ để truy cập từ ngoài nhà), đặt một reverse proxy có chứng chỉ — Caddy, nginx hoặc cloudflared — trên cùng máy, trỏ vào `http://127.0.0.1:3000`, rồi chạy `node scripts/chay-server.mjs --sau-proxy`. Ở chế độ này server chỉ nhận kết nối từ chính máy đó, tin các header `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` của proxy, và cookie phiên mang cờ `Secure` khi proxy báo `https`. Đừng dùng `--sau-proxy` khi không có proxy đứng trước: các header đó khi ấy do người gọi tự đặt.

Mạng nội bộ không có HTTPS nên mật khẩu đi qua wifi ở dạng chữ thường. Lệnh
kiểm tra ghi rõ điều này nhưng không coi là lỗi chặn khi địa chỉ nằm trong dải
IP riêng.

## Dùng thật

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

Trên Cloudflare thì khác — dùng `npm run create-owner`, xem [docs/DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). Đừng dùng lệnh `wrangler d1 execute --local` mà script đó in ra cho chế độ server ở máy: wrangler ghi vào một file SQLite khác với file server đang dùng, lệnh báo thành công nhưng tài khoản không xuất hiện.

### Cập nhật bản mới

Tải mã nguồn mới về đè lên thư mục cũ (giữ nguyên `.wrangler/`), rồi chạy `chay-server.bat` như thường. Nếu bản mới có thay đổi cấu trúc dữ liệu, server tự sao lưu thư mục dữ liệu sang `.wrangler/state/server-sao-luu-...` rồi mới cập nhật, trước khi mở cổng.

### Sao lưu

Thư mục cần sao lưu là `.wrangler/state/server`. Tắt server, chép nguyên thư mục đó sang ổ khác hoặc lên đám mây. Chạy trên máy local không có sao lưu tự động hằng ngày, không có HTTPS, và máy tắt là mất truy cập; dùng lâu dài thì cân nhắc đưa lên Cloudflare — xem [docs/DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

Nhóm route `/api/dev/` mặc định bị khóa ngoài môi trường dev. Bản build production chỉ mở khi có đủ hai thứ: biến `ALLOW_DEV_SETUP=true`, và biến `DEV_SETUP_TOKEN` (ít nhất 24 ký tự) khớp với header `x-dev-setup-token` của yêu cầu. `chay-server` tự sinh token cho các bước khởi tạo chạy trong tiến trình của nó. Đừng bao giờ đặt `ALLOW_DEV_SETUP` trên bản chạy thật; token chỉ là lớp chặn thứ hai cho trường hợp lỡ tay.

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

## Danh sách kiểm trước khi chạy thật

- Khởi tạo cơ sở dữ liệu thật bằng đường **trống** (xem mục "Dùng thật"), không chạy `db:setup`.
- Kiểm tra tài khoản mẫu không đăng nhập được trên môi trường thật.
- Không commit `.env` (đang nằm trong `.gitignore`).
- Đảm bảo `ALLOW_DEV_SETUP` không được đặt trên môi trường thật — biến này mở route xóa sạch cơ sở dữ liệu.
