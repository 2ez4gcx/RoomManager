# Hướng dẫn triển khai trên VPS

> **Lưu ý:** mã nguồn hiện chạy trên Cloudflare Workers + D1, không phải VPS +
> PostgreSQL. Hướng dẫn cho nền tảng đang dùng nằm ở
> [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).
>
> Tài liệu này là kế hoạch cho phương án VPS nếu chủ dự án chọn hướng đó; chưa
> thực hiện trên server và chưa thay đổi DNS. Chuyển hướng sẽ phải gỡ
> `@cloudflare/vite-plugin`, đổi dialect Drizzle sang postgres và thay
> `db/index.ts`.

## Kiến trúc khuyến nghị

```text
Internet → Cloudflare/DNS → Caddy hoặc Nginx → RoomManager
                                             ├─ PostgreSQL (private)
                                             └─ Object storage (ảnh/tài liệu)
```

Với 40 phòng, VPS 2 vCPU, 4 GB RAM và SSD 40–80 GB thường là đủ cho app, reverse proxy và PostgreSQL. Nếu VPS chỉ có 1–2 GB RAM, nên dùng PostgreSQL được quản lý hoặc nâng RAM để tránh cạnh tranh bộ nhớ khi build.

## Chuẩn bị

- Ubuntu LTS còn hỗ trợ cập nhật bảo mật.
- Một subdomain như `app.tenmien.vn` cho quản trị; có thể dùng `phong.tenmien.vn` cho trang công khai.
- Docker Engine + Compose plugin, hoặc Node.js 22 nếu triển khai trực tiếp.
- Mật khẩu cơ sở dữ liệu dài, khóa phiên đăng nhập và email gửi thông báo.
- Firewall chỉ mở SSH, HTTP và HTTPS; cổng PostgreSQL không mở ra Internet.

## Trình tự triển khai an toàn

1. Tạo user hệ thống không phải `root`, bật đăng nhập SSH bằng key và tắt đăng nhập mật khẩu sau khi xác nhận key hoạt động.
2. Cài Docker/Compose và reverse proxy.
3. Clone source từ repository riêng khi chủ dự án đã yêu cầu đưa lên GitHub.
4. Tạo `.env` trực tiếp trên VPS từ `.env.example`; không commit file này.
5. Khởi động PostgreSQL, chạy migration, sau đó khởi động ứng dụng.
6. Cấu hình reverse proxy tới cổng nội bộ của app và cấp HTTPS tự động.
7. Trỏ DNS sau khi kiểm tra bằng hostname tạm hoặc file hosts.
8. Tạo tài khoản chủ nhà đầu tiên, đổi mật khẩu và bật 2FA khi module xác thực hoàn tất.

## Biến môi trường dự kiến

```dotenv
NODE_ENV=production
APP_URL=https://app.tenmien.vn
DATABASE_URL=postgresql://roommanager:MAT_KHAU_MANH@db:5432/roommanager
SESSION_SECRET=CHUOI_NGAU_NHIEN_TOI_THIEU_32_KY_TU
STORAGE_ENDPOINT=
STORAGE_BUCKET=roommanager-private
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
```

## Sao lưu và phục hồi

- `pg_dump` mỗi đêm, giữ 7 bản ngày + 4 bản tuần.
- Sao lưu phải được đẩy sang nơi khác VPS (S3/R2/Backblaze hoặc máy NAS).
- Mỗi tháng thử phục hồi vào một database tạm; bản sao lưu chưa từng thử restore chưa thể xem là an toàn.
- Ảnh/tài liệu dùng versioning hoặc lifecycle riêng.

## Kiểm tra trước khi mở thật

- HTTPS, redirect HTTP, cookie `Secure`/`HttpOnly` và rate limit đăng nhập.
- Nhân viên không xem được dữ liệu ngoài quyền.
- Không lộ thông tin khách thuê ở trang đặt phòng công khai.
- Hai người không thể xác nhận cùng một phòng trong cùng thời gian.
- Số phải thu, đã thu, còn nợ khớp khi thanh toán một phần/hủy đơn.
- Import dữ liệu mẫu và phục hồi backup thành công.

## Cập nhật phiên bản

Mỗi lần cập nhật: sao lưu database, build image mới, chạy migration tương thích ngược, kiểm tra healthcheck rồi mới chuyển traffic. Giữ image phiên bản trước để rollback nhanh. Migration phá hủy cột/dữ liệu phải tách thành bước riêng và được duyệt thủ công.
