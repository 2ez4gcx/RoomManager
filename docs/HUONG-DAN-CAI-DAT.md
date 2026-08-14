# RoomManager — Hướng dẫn cài đặt

Tài liệu này dành cho người nhận phần mềm và tự cài lấy. Không cần biết lập
trình, nhưng phải gõ được vài dòng lệnh theo mẫu.

Đọc hết **Bước 0** trước khi bắt đầu — chọn sai kiểu cài thì làm lại từ đầu.

---

## Bước 0. Chọn kiểu cài

Có hai kiểu, khác nhau ở chỗ dữ liệu nằm đâu:

| | **Chạy trên một máy tính** | **Chạy trên Internet (Cloudflare)** |
|---|---|---|
| Mở được từ đâu | Chỉ máy đó | Điện thoại, máy nào cũng được |
| Dữ liệu nằm ở | Ổ cứng máy đó | Máy chủ Cloudflare |
| Sao lưu | Bạn tự lo | Tự động, khôi phục được 30 ngày |
| Máy tắt thì | Không ai vào được | Vẫn chạy |
| Chi phí | 0đ | 0đ với quy mô dưới ~100 phòng |
| Cần gì | Máy tính Windows | Thêm một tài khoản Cloudflare |
| Thời gian cài | ~15 phút | ~40 phút |

**Khuyến nghị: chạy trên Internet.** Kiểu "một máy tính" hợp để xem thử hoặc
dùng tạm vài ngày. Dùng lâu dài mà để dữ liệu trên một ổ cứng không sao lưu thì
ổ hỏng là mất sạch hợp đồng và công nợ, không có đường lấy lại.

- Muốn xem thử trước → làm **Phần A**, sau này chuyển sang Internet vẫn được
  (nhưng dữ liệu đã nhập **không tự chuyển theo**, phải nhập lại).
- Làm thật ngay → làm **Phần A** để chạy thử cho quen, rồi làm **Phần B**.

---

## Chuẩn bị chung

Cần cài **Node.js** phiên bản 22.13 trở lên:

1. Vào <https://nodejs.org>, tải bản **LTS**.
2. Cài như phần mềm bình thường, bấm Next tới hết, không đổi gì.
3. Khởi động lại máy.

Kiểm tra: mở **Command Prompt** (bấm phím Windows, gõ `cmd`, Enter) rồi gõ:

```bash
node -v
```

Phải hiện số dạng `v22.x.x` hoặc cao hơn. Hiện lỗi "không tìm thấy lệnh" thì
Node.js chưa cài xong hoặc chưa khởi động lại máy.

Giải nén thư mục phần mềm vào chỗ dễ tìm, ví dụ `D:\RoomManager`. Nên chọn
đường dẫn ngắn, không dấu tiếng Việt và không có khoảng trắng — đường dẫn kiểu
`D:\Tài liệu\Phần mềm nhà trọ` dễ gây lỗi khó hiểu ở các công cụ dòng lệnh.

---

# Phần A. Chạy trên một máy tính

## A1. Khởi động

Vào thư mục phần mềm, nhấp đúp **`start.bat`**.

Lần đầu sẽ mất 2–5 phút để tải thư viện, cửa sổ đen chạy nhiều dòng chữ — bình
thường. Xong thì trình duyệt tự mở trang đăng nhập.

**Cửa sổ đen đó phải luôn mở.** Đóng nó là phần mềm tắt. Muốn dùng thì nhấp đúp
`start.bat` lại.

Lúc này phần mềm đang chạy **dữ liệu mẫu**: 2 nhà, 40 phòng, khách thuê và đơn
thu bịa sẵn để bạn bấm thử. Tài khoản xem thử:

| Đăng nhập | Mật khẩu |
|---|---|
| `quanly@hoangan.vn` | `roommanager` |

Cứ bấm thử thoải mái, có làm hỏng gì cũng không sao — đây là dữ liệu giả.

## A2. Xoá dữ liệu mẫu, bắt đầu nhập dữ liệu thật

Xem thử xong, muốn nhập số liệu thật của nhà trọ mình thì nhấp đúp
**`khoi-tao-that.bat`** (cửa sổ đen của `start.bat` vẫn phải đang mở).

File này sẽ:

1. Hỏi bạn gõ `dung that` để xác nhận — đây là bước **xoá sạch**, gõ sai thì nó
   huỷ, không xoá gì.
2. Xoá toàn bộ dữ liệu mẫu.
3. Hỏi email, họ tên, mật khẩu để tạo tài khoản chủ nhà của bạn.

Về mật khẩu: đặt ít nhất 8 ký tự, **đừng dùng lại mật khẩu email hay ngân
hàng**. Phần mềm này giữ thông tin khách thuê và công nợ, nên nó đáng được một
mật khẩu riêng.

Ở bước này chỉ dùng **chữ không dấu và số**. Mật khẩu đi qua cửa sổ dòng lệnh
nên chữ có dấu có thể bị đổi mà không báo lỗi — gõ xong lại không đăng nhập
được, không hiểu vì sao. Đăng nhập xong muốn đổi sang mật khẩu phức tạp hơn thì
vào trang *Cài đặt*, ở đó gõ gì cũng được.

Xong là xong. Đăng nhập bằng tài khoản vừa tạo, phần mềm trống trơn, bắt đầu
nhập từ **Nhà & phòng**.

## A3. Ba việc làm ngay sau khi đăng nhập lần đầu

1. **Bật xác thực hai bước** ở trang *Cài đặt*. Cần một ứng dụng như Google
   Authenticator hoặc Microsoft Authenticator trên điện thoại. Quét mã QR, nhập
   mã 6 số. **Chụp lại mã khôi phục và cất riêng** — mất điện thoại mà không có
   mã đó thì không vào được.
2. **Tạo tài khoản chủ nhà thứ hai** ở trang *Tài khoản*, cho người bạn tin
   tưởng. Chỉ có một tài khoản chủ nhà mà quên mật khẩu thì không ai cấp lại
   được, phải sửa thẳng cơ sở dữ liệu.
3. **Nhập thử một phòng và một khách thuê**, xem số liệu ở trang *Tổng quan* có
   đúng không, rồi mới nhập hàng loạt.

## A4. Những gì tuyệt đối không làm sau khi đã nhập dữ liệu thật

- **Đừng chạy `reset-data.bat`.** File này xoá sạch dữ liệu thật rồi nạp lại dữ
  liệu mẫu. Không hoàn tác được. Nó chỉ dành cho lúc xem thử.
- **Đừng xoá thư mục `.wrangler`** trong thư mục phần mềm. Toàn bộ dữ liệu nằm ở
  đó.
- **Đừng chạy `khoi-tao-that.bat` lần nữa** — nó xoá sạch để làm lại từ đầu.

## A5. Sao lưu (bắt buộc, kiểu này không tự sao lưu)

Mỗi tuần: đóng cửa sổ đen để dừng phần mềm, rồi chép cả thư mục **`.wrangler`**
sang USB hoặc Google Drive, đặt tên theo ngày, ví dụ `wrangler-2026-08-14`.

Nếu không thấy thư mục `.wrangler`: mở File Explorer → thẻ *View* → tích
*Hidden items*.

Muốn phục hồi: dừng phần mềm, xoá thư mục `.wrangler` hiện có, chép bản sao lưu
vào đúng chỗ cũ, chạy lại `start.bat`.

Bản sao lưu chưa từng thử phục hồi thì chưa chắc dùng được. Mỗi tháng nên thử
một lần trên máy khác.

---

# Phần B. Chạy trên Internet (Cloudflare)

Kiểu này để phần mềm chạy trên máy chủ Cloudflare: mở được từ điện thoại, có
HTTPS, dữ liệu tự sao lưu và khôi phục được trong vòng 30 ngày.

Với quy mô dưới khoảng 100 phòng thì gói miễn phí là đủ, không cần thẻ tín dụng.

Toàn bộ các bước nằm ở **[DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)**. Tóm
tắt để bạn hình dung trước:

1. Tạo tài khoản tại <https://dash.cloudflare.com/sign-up>.
2. `npx wrangler login` — mở trình duyệt để cấp quyền.
3. `npx wrangler d1 create room-manager` — tạo cơ sở dữ liệu, chép lại mã
   `database_id` mà nó in ra.
4. Build với mã đó, chạy `npm run deploy:migrate` để dựng bảng.
5. `npm run create-owner` rồi chạy lệnh nó in ra, để tạo tài khoản chủ nhà đầu
   tiên.
6. `npm run deploy`. Xong sẽ có địa chỉ dạng
   `https://room-manager.<tên-của-bạn>.workers.dev`.

Phần này gõ lệnh nhiều hơn Phần A. Không tự tin thì nhờ người quen rành máy
tính làm giúp một lần — làm xong rồi thì dùng hàng ngày chỉ cần mở trình duyệt,
không phải gõ gì nữa.

**Sau khi lên Internet, kiểm tra ba điều này** (đầy đủ hơn ở mục 7 của
DEPLOY-CLOUDFLARE.md):

- Mở trang chủ bằng **cửa sổ ẩn danh** — phải bị đẩy về trang đăng nhập.
- Mở trang `/booking` bằng cửa sổ ẩn danh — phải xem được phòng trống, và
  **không** thấy tên khách thuê, số điện thoại hay công nợ.
- Đừng bao giờ đặt biến `ALLOW_DEV_SETUP` trên môi trường thật. Biến này mở một
  đường xoá sạch cơ sở dữ liệu.

---

## Dùng hàng ngày

Phần mềm gồm các trang:

| Trang | Dùng để |
|---|---|
| **Tổng quan** | Xem nhanh: đã thu bao nhiêu, còn nợ bao nhiêu, phòng trống, việc cần làm |
| **Nhà & phòng** | Thêm nhà, thêm loại phòng, thêm phòng; xem phòng nào đang thuê |
| **Khách thuê** | Hồ sơ khách và hợp đồng, theo dõi công nợ, làm thủ tục trả phòng |
| **Đặt phòng** | Yêu cầu xem phòng khách gửi từ trang công khai, xác nhận hoặc từ chối |
| **Lập đơn thu** | Cuối kỳ: nhập chỉ số điện từng phòng rồi phát hành đơn cho tất cả phòng một lượt |
| **Đơn & doanh thu** | Xem chi tiết đơn, ghi nhận thanh toán, huỷ đơn lập nhầm |
| **Thu chi** | Sổ thu chi, biểu đồ 6 tháng |
| **Nhắc nợ** | Danh sách ai sắp đến hạn / quá hạn, có sẵn tin nhắn để gửi Zalo |
| **Tài khoản** | Tạo tài khoản cho nhân viên, khoá/mở, cấp link quên mật khẩu |
| **Cài đặt** | Giá điện nước, chu kỳ thu, đổi mật khẩu, xác thực hai bước |

Nhân viên xem và nhập được dữ liệu vận hành nhưng không thêm được nhà, không
sửa được bảng giá và không quản lý được tài khoản.

**Nhắc nợ không tự gửi tin cho khách.** Phần mềm soạn sẵn nội dung, bạn chép rồi
gửi qua Zalo hoặc gọi điện, sau đó bấm đánh dấu đã nhắc. Gửi tự động cần Zalo OA
đã được duyệt hoặc dịch vụ SMS trả phí, chưa có trong bản này.

---

## Quên mật khẩu

Phần mềm **không gửi email**. Cách xử lý:

**Nhân viên hoặc chủ nhà thứ hai quên:** báo người còn đăng nhập được. Người đó
vào trang *Tài khoản*, bấm *Link quên mật khẩu* ở dòng của người quên, rồi gửi
link qua Zalo. Link sống một giờ, dùng một lần.

**Tất cả tài khoản chủ nhà đều quên:** phải sửa thẳng cơ sở dữ liệu. Chạy:

```bash
npm run hash-password "mat khau moi cua ban"
```

Rồi làm theo hướng dẫn nó in ra. Đây là lý do **luôn phải có hai tài khoản chủ
nhà**.

---

## Khi gặp trục trặc

**Nhấp `start.bat` mà cửa sổ đen hiện lên rồi tắt ngay**
Node.js chưa cài, hoặc cài rồi mà chưa khởi động lại máy. Xem lại mục *Chuẩn bị
chung*.

**Báo "Another vinext dev server is already running"**
Phần mềm đang chạy sẵn ở một cửa sổ khác. Cứ mở trình duyệt vào
<http://localhost:3000>.

**Trình duyệt báo "không thể kết nối"**
Cửa sổ đen đã bị đóng. Nhấp đúp `start.bat` lại, chờ đến khi hiện dòng báo sẵn
sàng.

**Đăng nhập báo sai mật khẩu dù chắc chắn gõ đúng**
Có thể đang bị tạm khoá do nhập sai 5 lần trong 15 phút. Chờ hết 15 phút.

**Vừa chạy `khoi-tao-that.bat` xong mà không đăng nhập được**
Nhiều khả năng mật khẩu có chữ có dấu hoặc ký tự lạ, bị đổi lúc gửi đi. Lúc này
bạn **chưa nhập dữ liệu gì**, nên cứ chạy lại `khoi-tao-that.bat` từ đầu và đặt
mật khẩu chỉ gồm chữ không dấu và số. (Lời dặn "đừng chạy lại" ở mục A4 chỉ áp
dụng sau khi bạn đã nhập số liệu thật.)

**Chạy nhầm `reset-data.bat`, mất dữ liệu thật**
Kiểu "một máy tính": phục hồi từ bản sao lưu thư mục `.wrangler` (mục A5). Không
có bản sao lưu thì không lấy lại được.
Kiểu Cloudflare: dùng Time Travel, xem mục 9 của DEPLOY-CLOUDFLARE.md.

**Muốn chuyển dữ liệu từ máy tính lên Cloudflare**
Không có nút tự chuyển. Số lượng ít thì nhập lại tay; nhiều thì cần người rành
kỹ thuật xuất từ SQLite và nạp vào D1.

---

## Tài liệu khác

- [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md) — các bước đưa lên Internet, đầy
  đủ, kèm mục sao lưu và cập nhật phiên bản sau này.
- [DATA-MODEL.md](DATA-MODEL.md) — dữ liệu được lưu như thế nào, dành cho người
  kỹ thuật.
- [README.md](../README.md) — mô tả tính năng và cách chạy dành cho lập trình
  viên.
