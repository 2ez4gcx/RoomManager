# Mô hình dữ liệu

> **Trạng thái:** đã triển khai trong [`db/schema.ts`](../db/schema.ts), migration
> đầu tiên nằm ở `drizzle/`. Chạy trên Cloudflare D1 (SQLite). Nền tảng lâu dài
> chưa chốt — schema được viết ở dạng trung lập để chuyển sang PostgreSQL mà
> không phải đổi cấu trúc, xem mục cuối trang.

## Thực thể cốt lõi

| Nhóm | Bảng | Vai trò |
|---|---|---|
| Tổ chức | `users`, `sessions`, `login_attempts` | Tài khoản, vai trò, phiên đăng nhập và lịch sử nhập sai |
| Tài sản | `properties`, `room_types`, `rooms` | Hai nhà, loại phòng và 40 phòng cụ thể |
| Khách | `guests` | Thông tin người thuê; số CCCD là dữ liệu nhạy cảm, không ra trang công khai |
| Thuê | `contracts`, `contract_guests` | Thời hạn, giá, cọc và người cùng ở |
| Đặt phòng | `booking_requests` | Yêu cầu công khai; thời hạn giữ chỗ ở cột `hold_until` |
| Đơn thu | `invoices`, `invoice_items` | Một đơn theo kỳ và các dòng tiền phòng/điện/nước/phụ thu |
| Thanh toán | `payments`, `payment_allocations` | Tiền thực nhận và phần được cấn vào từng đơn |
| Vận hành | `meter_readings`, `maintenance_requests` | Chỉ số điện nước và bảo trì |
| Sổ quỹ | `ledger_entries` | Thu chi vận hành; khoản thu tiền phòng sinh từ `payments` |
| Cấu hình | `settings` | Bảng giá và thông tin nhà trọ, chủ nhà tự sửa được |
| Kiểm soát | `audit_logs` | Lịch sử sửa/xóa/đổi trạng thái |

Bảng `guest_documents` trong bản phác thảo chưa làm: chưa có luồng tải ảnh giấy
tờ nên chưa cần object storage.

## Quy tắc quan trọng

- Tiền lưu dạng số nguyên VNĐ, không dùng số thực.
- `invoice_items` lưu cả số lượng, đơn giá và thành tiền tại lúc lập đơn để lịch sử không đổi khi bảng giá đổi.
- Một đơn có thể được trả nhiều lần; một lần thanh toán cũng có thể cấn nhiều đơn.
- Không xóa cứng đơn đã phát hành hoặc thanh toán; dùng trạng thái hủy và lưu người thực hiện.
- Trạng thái phòng được suy ra từ hợp đồng/giữ chỗ/bảo trì, tránh nhiều cờ mâu thuẫn.
- Mọi bảng nghiệp vụ có `created_at`, `updated_at`, người tạo và mã nhà để truy vết.

## Khác biệt so với bản phác thảo ban đầu

- Sổ thu chi tên `ledger_entries` thay vì `transactions`, tránh nhầm với giao
  dịch cơ sở dữ liệu.
- `booking_holds` không tách riêng: thời hạn giữ chỗ nằm ở cột
  `booking_requests.hold_until`. Với quy mô này một bảng là đủ và tránh phải
  đồng bộ hai nơi.
- `memberships` chưa cần: vai trò nằm thẳng ở `users.role` vì hệ thống chỉ phục
  vụ một chủ sở hữu. Thay vào đó có `sessions` cho đăng nhập.

## Quy tắc về giữ chỗ

Một phòng chỉ được giữ cho đúng một yêu cầu tại một thời điểm; xác nhận yêu cầu
thứ hai sẽ bị từ chối. Khi hợp đồng được ký cho phòng đó, `hold_until` của mọi
yêu cầu đã xác nhận trên phòng được xóa — nếu không, sau khi hợp đồng kết thúc
phòng sẽ hiện lại "Đã giữ" do một chỗ giữ cũ đã hết ý nghĩa.

## Giới hạn số lần đăng nhập sai

`login_attempts` đếm lần nhập sai trong cửa sổ trượt 15 phút. Hai ngưỡng:

- 5 lần cho một cặp (định danh + IP).
- 20 lần cho một IP, tính trên mọi định danh — bắt kiểu rải một mật khẩu phổ
  biến lên nhiều tài khoản.

Cố ý **không** khóa theo riêng tài khoản: khi đó người ngoài chỉ cần biết email
của chủ nhà là nhập sai liên tục để khóa chính chủ ra khỏi hệ thống. Gắn thêm IP
thì kẻ tấn công chỉ tự khóa mình.

Khóa tự hết sau cửa sổ, không cần ai mở thủ công — hệ thống chỉ có một chủ nhà
và chưa có kênh khôi phục nào khác.

Lần thử được **ghi trước rồi mới đếm**. Nếu đếm trước, một loạt yêu cầu gửi song
song sẽ cùng đọc bộ đếm cũ và đều lọt qua, tức bắn đồng thời là lách được.

## Vòng đời tài khoản

Tài khoản **không bị xóa cứng**: `contracts.created_by`, `payments.recorded_by`
và `audit_logs.actor_id` đều trỏ tới `users`, xóa đi là mất dấu vết ai đã làm
gì. Thay vào đó dùng cờ `users.is_active`.

Khóa tài khoản sẽ xóa luôn mọi phiên của người đó. Nếu chỉ đặt cờ mà giữ phiên
thì họ vẫn dùng tiếp được tới khi phiên hết hạn, tức việc khóa không có tác
dụng ngay.

Hệ thống phải luôn còn ít nhất một chủ nhà đang hoạt động: khóa hoặc hạ quyền
chủ nhà cuối cùng đều bị từ chối. Không có ràng buộc này thì có thể rơi vào
trạng thái không ai vào được trang quản lý tài khoản để sửa lại. Người dùng
cũng không tự khóa hay tự hạ quyền chính mình.

## Mật khẩu và phiên

Mật khẩu băm bằng PBKDF2-SHA256 (Web Crypto), vì Workers không chạy được
bcrypt/argon2 là mã native. `sessions.id` lưu băm SHA-256 của token trong cookie
chứ không lưu chính token, nên rò rỉ bảng này không cho phép mạo danh ai.

## Cách giữ schema chuyển được sang PostgreSQL

Nền tảng lâu dài chưa chốt, nên schema tránh mọi thứ chỉ SQLite mới có:

- Khóa chính là `text` do ứng dụng sinh (`db/ids.ts`), không dùng `AUTOINCREMENT`.
- Tiền là số nguyên VNĐ. Số lượng có phần thập phân lưu dạng nguyên nhân 100
  (`invoice_items.quantity_centi`), không dùng `REAL`.
- Ngày lịch lưu `text` dạng `YYYY-MM-DD`; mốc thời gian hệ thống lưu epoch
  millisecond.
- Trạng thái lưu `text` kèm union type ở tầng TypeScript, không dùng enum của CSDL.

Khi chuyển sang PostgreSQL, phần lớn công việc là đổi `drizzle-orm/sqlite-core`
thành `drizzle-orm/pg-core` và sinh lại migration. Riêng hai chỗ phải sửa tay:
`sql\`(unixepoch() * 1000)\`` ở giá trị mặc định, và biểu thức `date(...)` trong
`db/queries.ts`.

## Nếu chọn phương án VPS

- PostgreSQL làm nguồn dữ liệu chính.
- Drizzle ORM cho schema và migration.
- Lưu ảnh phòng/giấy tờ ở object storage tương thích S3; không nhét file lớn vào PostgreSQL.
- Redis chỉ thêm khi thật sự cần hàng đợi gửi tin hoặc khóa giữ phòng; MVP chưa cần.
