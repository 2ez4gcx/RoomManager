# Mô hình dữ liệu

> **Trạng thái:** đã triển khai trong [`db/schema.ts`](../db/schema.ts), migration
> đầu tiên nằm ở `drizzle/`. Chạy trên Cloudflare D1 (SQLite). Nền tảng lâu dài
> chưa chốt — schema được viết ở dạng trung lập để chuyển sang PostgreSQL mà
> không phải đổi cấu trúc, xem mục cuối trang.

## Thực thể cốt lõi

| Nhóm | Bảng | Vai trò |
|---|---|---|
| Tổ chức | `users`, `sessions`, `login_attempts`, `recovery_codes`, `password_reset_tokens` | Tài khoản, vai trò, phiên, lịch sử nhập sai, mã khôi phục 2FA và link đặt lại mật khẩu |
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

## Trả phòng và tiền cọc

Dòng tiền của cọc được ghi ở **hai đầu**:

- Ký hợp đồng: cọc vào `ledger_entries` là khoản thu, ghi đúng ngày bắt đầu.
- Trả phòng: phần hoàn lại ra `ledger_entries` là khoản chi.

Phần cọc dùng để cấn nợ hoặc bị khấu trừ thì **không** ghi sổ lần nữa — tiền
mặt đó đã vào từ lúc thu cọc, ghi thêm là đếm hai lần. `recordPayment` có tham
số `skipLedger` cho đúng trường hợp này. Nhờ vậy số dư sổ quỹ khớp tiền thật
trong két.

Thứ tự tất toán: cấn nợ đơn thu trước (cũ trước mới sau), rồi tới khấu trừ hư
hỏng, còn lại bao nhiêu thì hoàn. Cọc không đủ thì phần thiếu **vẫn nằm nguyên
ở các đơn chưa thu** — đó là tiền chủ nhà còn quyền đòi, không tự xóa.

Hợp đồng chuyển sang `status = 'ended'`, và vì trạng thái phòng được suy ra từ
hợp đồng nên phòng thành trống ngay, cho thuê lại được luôn.

## Lập đơn thu theo kỳ

Một kỳ là một tháng dương lịch (`YYYY-MM`). Ràng buộc UNIQUE trên
`(contract_id, period)` là thứ đảm bảo không lập trùng: bấm lại lần hai chỉ bỏ
qua chứ không tạo thêm đơn.

Hợp đồng bắt đầu giữa kỳ thì tiền phòng **chia theo ngày**, làm tròn tới nghìn
đồng — thu trọn tháng của người dọn vào ngày 28 là thu sai. Số ngày thực tế
được ghi vào mô tả dòng tiền phòng để đối chiếu về sau.

Chỉ số điện phải do người chốt sổ nhập tay, nên luồng gồm hai bước: xem trước
rồi mới phát hành. Chỉ số cuối kỳ này thành chỉ số đầu kỳ sau. Không nhận chỉ
số nhỏ hơn chỉ số cũ vì công tơ không quay ngược.

## Hủy đơn thu

Đơn không xóa cứng, chỉ chuyển `status = 'cancelled'` kèm người hủy và lý do.
Đơn đã thu tiền thì không hủy được: sẽ để lại khoản thanh toán treo không thuộc
đơn nào, mà hệ thống chưa có chức năng hoàn tiền.

Ràng buộc UNIQUE `(contract_id, period)` là **index một phần** bỏ qua đơn đã
hủy, nếu không thì một lần lập nhầm sẽ khóa kỳ đó vĩnh viễn. Mã đơn vẫn duy
nhất toàn cục — lần lập lại được thêm hậu tố `-L2`, `-L3` — để khi báo khách
"đơn DT-..." thì mã đó chỉ trỏ tới đúng một đơn.

Hủy đơn **giữ nguyên** bản ghi `meter_readings` của kỳ đó, chỉ bỏ tham chiếu ở
dòng hóa đơn. Xóa hẳn thì mốc chỉ số đầu kỳ biến mất và lần lập lại sẽ tính từ
0, ra một hóa đơn điện khổng lồ. Khi lập lại, `previousValue` của chính bản ghi
đó là mốc đầu kỳ, và bản ghi được ghi đè thay vì chèn mới.

Đơn đã hủy có `outstanding` bằng 0 ở tầng truy vấn: để nguyên `total − paid`
thì nó vẫn hiện "còn nợ", lệch với công nợ theo phòng vốn đã loại đơn hủy ra.

`meter_readings.unit_price` lưu đơn giá tại thời điểm chốt, nên bảng giá đổi
sau không làm đổi các đơn đã lập.

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

## Đặt lại mật khẩu

`password_reset_tokens.id` lưu băm SHA-256 của token trong link, không lưu
chính token — cùng nguyên tắc với `sessions`.

Link sống một giờ và dùng một lần. Cấp link mới sẽ hủy mọi link chưa dùng của
tài khoản đó: để nhiều link cùng sống nghĩa là mỗi lần bấm nhầm lại thêm một
chìa khóa đang trôi nổi.

Dùng link xong thì hủy toàn bộ phiên của tài khoản. Link **không** tự cấp phiên
đăng nhập: nếu tự cấp thì nó thành đường vòng qua xác thực hai bước.

## Mật khẩu và phiên

Mật khẩu băm bằng PBKDF2-SHA256 (Web Crypto), vì Workers không chạy được
bcrypt/argon2 là mã native. `sessions.id` lưu băm SHA-256 của token trong cookie
chứ không lưu chính token, nên rò rỉ bảng này không cho phép mạo danh ai.

## Xác thực hai bước

Dùng TOTP theo RFC 6238 (mã 6 số, đổi mỗi 30 giây), tương thích Google
Authenticator, Authy và tương đương. Chọn TOTP vì hệ thống chưa có dịch vụ gửi
SMS hay email nào.

Thuật toán chuẩn dùng HMAC-SHA1. SHA-1 đã yếu với bài toán chống va chạm nhưng
HMAC-SHA1 thì chưa bị phá, và đổi sang SHA-256 sẽ không quét được bằng ứng dụng
phổ thông.

Bật gồm **hai bước**: `users.totp_secret` được ghi khi sinh khóa, nhưng
`users.totp_enabled_at` — cờ "đã bật" thật sự — chỉ được đặt sau khi người dùng
nhập đúng một mã. Bật ngay lúc sinh khóa thì người quét hụt sẽ tự khóa mình ra
khỏi hệ thống.

`users.totp_last_counter` lưu bước thời gian của mã vừa dùng. Mã thuộc bước đó
hoặc cũ hơn bị từ chối, nếu không ai nhìn trộm màn hình vẫn kịp dùng lại mã
trong 30 giây còn hiệu lực. Hệ quả cần biết: ngay sau khi bật, phải chờ mã kế
tiếp mới đăng nhập được.

Khóa được đưa vào ứng dụng bằng mã QR. Máy chủ sinh **ma trận điểm** rồi giao
diện tự vẽ SVG bằng React, thay vì máy chủ trả chuỗi SVG để chèn thẳng vào
trang — nhờ vậy không cần `dangerouslySetInnerHTML`. Vẫn giữ đường nhập khóa
thủ công cho trường hợp không quét được.

`recovery_codes` giữ 8 mã dùng khi mất điện thoại, lưu băm SHA-256. Ở đây không
cần PBKDF2 như mật khẩu vì mã do hệ thống sinh ngẫu nhiên đủ dài, không dò được
bằng từ điển.

Bước "đúng mật khẩu nhưng chưa nhập mã" **không** bị tính vào giới hạn đăng
nhập sai; nếu tính thì người bật 2FA sẽ hết lượt chỉ sau vài lần đăng nhập bình
thường. Nhập sai mã thì có tính.

## Xuất Excel

File `.xlsx` được sinh trực tiếp trong `db/xlsx.ts` và `db/zip.ts`, không dùng
thư viện ngoài: định dạng này chỉ là một kho ZIP chứa vài file XML, còn thư
viện đọc/ghi Excel phổ biến nặng gần một megabyte — đủ để chạm giới hạn kích
thước bundle của Cloudflare Workers.

ZIP ghi ở chế độ không nén cho gọn mã. Bảng vài trăm dòng vẫn chỉ vài chục KB.

Tiền được ghi là **số** kèm định dạng `#,##0`, không phải chuỗi đã định dạng
sẵn — có vậy mới cộng được trong Excel. Số điện thoại thì ngược lại, phải là
chuỗi, nếu không Excel cắt mất số 0 đứng đầu.

Bài kiểm thử mở lại file bằng SheetJS (thư viện khác với mã đã sinh ra nó) và
đối chiếu từng ô với dữ liệu gốc — kiểm tra vài byte đầu không chứng minh được
Excel mở lên đọc ra đúng thứ.

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
