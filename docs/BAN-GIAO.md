# Đóng gói và bàn giao cho khách hàng

Tài liệu này dành cho **người bàn giao**, không gửi cho khách. Bản gửi khách là
[HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md), nằm sẵn trong gói.

## Đóng gói

Nhấp đúp **`dong-goi.bat`**, hoặc chạy:

```bash
git archive --format=zip HEAD -o RoomManager.zip
```

`git archive` chỉ lấy những file đang được git theo dõi. Đây là điểm mấu chốt:
nó **không thể** vô tình gói kèm dữ liệu, vì mọi thứ nhạy cảm đều nằm trong
`.gitignore`. Kết quả khoảng 1,5 MB, 202 file.

Đừng nén thư mục bằng chuột phải → *Send to* → *Compressed folder*. Cách đó gói
kèm cả những thứ dưới đây.

### Ba thứ tuyệt đối không được lọt vào gói

| | Vì sao |
|---|---|
| `.wrangler/` | **Chứa dữ liệu của chính bạn** — tên khách thuê, số điện thoại, công nợ, mật khẩu đã băm. Gửi nhầm là lộ thông tin cá nhân của khách thuê nhà bạn. |
| `.git/` | Toàn bộ lịch sử sửa đổi, gồm cả mật khẩu tài khoản dữ liệu mẫu ở các commit cũ. |
| `.env`, `node_modules/` | File cấu hình riêng và 400 MB thư viện khách tự cài được. |

Kiểm tra lại gói trước khi gửi:

```bash
unzip -l RoomManager.zip | grep -E "\.wrangler|\.git/|\.env|node_modules" || echo "Gói sạch"
```

Phải in ra `Gói sạch`.

## Trước khi gửi

- [ ] `npm test` và `npm run lint` đều xanh trên commit sắp gói.
- [ ] Gói được tạo bằng `git archive`, đã chạy lệnh kiểm tra ở trên.
- [ ] Thử giải nén ra thư mục khác, chạy `start.bat`, đăng nhập bằng tài khoản
      xem thử. Đây là bước duy nhất bắt được lỗi kiểu "thiếu file".

## Gửi kèm gì

1. File `RoomManager.zip`.
2. Nói khách đọc `docs/HUONG-DAN-CAI-DAT.md` **bên trong gói** trước khi làm gì.
3. Cho khách biết trước hai điều, để họ khỏi hiểu nhầm:
   - Phần mềm chạy sẵn **dữ liệu mẫu** để họ bấm thử. Muốn nhập số liệu thật thì
     chạy `khoi-tao-that.bat`, xoá sạch mẫu rồi tạo tài khoản riêng.
   - **Nhắc nợ không tự gửi tin** cho khách thuê. Nó soạn sẵn nội dung, người
     dùng chép và gửi qua Zalo. Đây là điểm dễ bị kỳ vọng sai nhất.

## Về tài khoản dữ liệu mẫu trong gói

Gói có kèm tài khoản `quanly@hoangan.vn` / `roommanager`, mật khẩu nằm công khai
trong `db/seed.ts`. Cố ý để vậy: khách cần một đường vào để xem thử ngay, và tài
khoản này chỉ tồn tại trong cơ sở dữ liệu mẫu trên máy họ.

Nó trở thành lỗ hổng nếu khách bỏ qua bước `khoi-tao-that.bat` mà nhập luôn dữ
liệu thật đè lên dữ liệu mẫu — khi đó tài khoản có mật khẩu công khai vẫn mở
được số liệu thật. Hướng dẫn đã nói rõ, nhưng nếu bạn có trao đổi trực tiếp thì
nhắc lại một câu.

## Hỗ trợ sau bàn giao

Khách sẽ hỏi nhiều nhất ba việc:

**"Mở trên điện thoại thế nào?"** — Kiểu chạy trên một máy tính thì không mở
được từ điện thoại. Muốn vậy phải đưa lên Cloudflare, xem
[DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). Nên hỏi rõ nhu cầu này ngay từ đầu
để khách chọn đúng kiểu cài, khỏi nhập dữ liệu hai lần.

**"Quên mật khẩu rồi"** — Nếu còn một tài khoản chủ nhà đăng nhập được thì tự
cấp link ở trang *Tài khoản*. Nếu mất hết thì cần `npm run hash-password` và sửa
thẳng cơ sở dữ liệu.

**"Mất dữ liệu rồi"** — Kiểu một máy tính: chỉ cứu được nếu họ có bản sao lưu
thư mục `.wrangler`. Kiểu Cloudflare: Time Travel khôi phục được 30 ngày.

## Cập nhật phiên bản cho khách đã cài

Khách đã nhập dữ liệu thật thì **không được** bảo họ giải nén gói mới đè lên.
Cách an toàn:

1. Giải nén bản mới ra thư mục khác.
2. Chép thư mục `.wrangler` từ bản cũ sang bản mới.
3. Chạy `start.bat` ở bản mới. Migration mới sẽ tự áp lên dữ liệu cũ.

Kiểu Cloudflare thì theo mục 10 của [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)
— nhớ xuất bản sao lưu trước khi áp migration.
