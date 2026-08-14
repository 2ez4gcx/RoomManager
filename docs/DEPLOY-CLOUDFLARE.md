# Đưa RoomManager lên Cloudflare

Hướng dẫn cho phương án đang dùng: Cloudflare Workers + D1. Phương án VPS +
PostgreSQL nằm ở [DEPLOYMENT.md](DEPLOYMENT.md) và chưa được áp dụng.

> **Mức độ kiểm chứng.** Các bước dựng cấu hình, áp migration và tạo tài khoản
> chủ nhà đầu tiên đã được chạy thật ở máy local (D1 của Miniflare) và cho kết
> quả đúng. Các bước cần tài khoản Cloudflare — `login`, `d1 create`, `deploy`
> thật, tên miền riêng — chưa chạy được vì cần thông tin đăng nhập của chủ dự
> án. Chỗ nào chưa kiểm chứng đều được ghi rõ.

## 0. Trước khi bắt đầu

Cần có:

- Tài khoản Cloudflare (gói Free là đủ cho 40 phòng).
- Node.js `>=22.13.0`.
- Kho mã sạch: `npm test` và `npm run lint` đều xanh.

Kích thước bản build hiện tại là **1164 KiB, nén gzip còn 314 KiB** — dưới xa
giới hạn 3 MB của gói Free.

## 1. Đăng nhập Cloudflare

```bash
npx wrangler login
```

Lệnh mở trình duyệt để cấp quyền. Kiểm tra lại:

```bash
npx wrangler whoami
```

## 2. Tạo cơ sở dữ liệu D1

```bash
npx wrangler d1 create room-manager
```

Kết quả in ra `database_id` dạng `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. **Chép
lại**, bước sau cần tới.

Đây là mã định danh, không phải mật khẩu — ai không có quyền vào tài khoản
Cloudflare thì cầm mã này cũng không làm gì được. Nhưng cũng không cần đăng nó
lên chỗ công khai.

## 3. Build với thông tin D1 thật

Bản build mặc định trỏ vào một D1 giả để `npm run dev` chạy được ở máy. Muốn
deploy thì đặt hai biến môi trường:

```bash
CF_D1_DATABASE_NAME=room-manager \
CF_D1_DATABASE_ID=<database_id vừa lấy> \
npm run build
```

Trên PowerShell:

```powershell
$env:CF_D1_DATABASE_NAME = "room-manager"
$env:CF_D1_DATABASE_ID = "<database_id vừa lấy>"
npm run build
```

Kiểm tra cấu hình đã nhận đúng:

```bash
npx wrangler deploy --dry-run
```

Dòng cuối phải hiện `env.DB (room-manager)`. Nếu vẫn thấy `site-creator-d1` thì
biến môi trường chưa tới được lệnh build.

> Chạy `npm run build` mà **không** đặt biến sẽ quay lại D1 giả. Luôn đặt biến
> ở mọi lần build định deploy.

## 4. Tạo bảng trên D1 thật

```bash
npm run deploy:migrate
```

Lệnh này chạy `wrangler d1 migrations apply DB --remote`, áp lần lượt các file
SQL trong `drizzle/`. Wrangler ghi lại migration nào đã chạy nên gọi lại lần nữa
sẽ báo `No migrations to apply!` chứ không làm hỏng gì.

Kiểm tra:

```bash
npx wrangler d1 execute DB --remote --config dist/server/wrangler.json \
  --command "SELECT count(*) AS so_bang FROM sqlite_master WHERE type='table'"
```

Phải ra **21 bảng** nghiệp vụ (cộng vài bảng nội bộ của D1). Cơ sở dữ liệu lúc
này trống hoàn toàn — không có nhà, phòng hay tài khoản nào.

## 5. Tạo tài khoản chủ nhà đầu tiên

Cơ sở dữ liệu thật lúc này trống, chưa có ai để đăng nhập. Route nạp dữ liệu
mẫu cố ý bị khóa ngoài môi trường phát triển vì nó xóa sạch dữ liệu, nên tài
khoản đầu tiên phải tạo trực tiếp:

```bash
npm run create-owner -- "chunha@nhatro.vn" "Trần Văn A" "mat khau that cua ban" "0901234567"
```

Script in ra hai lệnh `wrangler d1 execute` đã ghép sẵn — một cho Cloudflare,
một cho cơ sở dữ liệu local. Lấy lệnh dưới mục **"Trên Cloudflare"**, thay
`<TEN_DATABASE>` bằng `room-manager`, rồi chạy.

Dữ liệu mẫu không bao giờ được nạp lên đây. `npm run db:setup` và
`reset-data.bat` chỉ chạy được với server dev ở máy, và tài khoản mẫu
`quanly@hoangan.vn` chỉ tồn tại trong cơ sở dữ liệu mẫu đó.

Sau khi đăng nhập lần đầu:

- Đổi mật khẩu ở trang **Cài đặt** (mật khẩu vừa gõ đang nằm trong lịch sử lệnh
  của terminal).
- Bật **xác thực hai bước**.
- Tạo thêm **một tài khoản chủ nhà thứ hai**. Chỉ có một chủ nhà mà quên mật
  khẩu thì không ai cấp được link đặt lại, phải sửa thẳng cơ sở dữ liệu.

## 6. Deploy

```bash
npm run deploy
```

Wrangler đọc `.wrangler/deploy/config.json` do bước build tạo ra, nên **phải
chạy từ thư mục gốc** của dự án, không phải từ `dist/`.

Xong sẽ có địa chỉ dạng `https://room-manager.<tên-tài-khoản>.workers.dev`.

## 7. Kiểm tra ngay sau khi deploy

Chạy đủ danh sách này trước khi giao cho ai dùng:

- [ ] Mở `/login` — vào được, có HTTPS.
- [ ] Đăng nhập bằng tài khoản vừa tạo.
- [ ] Mở `/` khi **chưa** đăng nhập (dùng cửa sổ ẩn danh) — phải bị đẩy về `/login`.
- [ ] Mở `/booking` khi chưa đăng nhập — phải xem được, và **không** thấy tên
      khách thuê, số điện thoại hay công nợ.
- [ ] `POST /api/dev/setup` phải trả **403**. Nếu trả 200 thì `ALLOW_DEV_SETUP`
      đã bị đặt nhầm — gỡ ngay, biến này mở đường xóa sạch cơ sở dữ liệu:

      ```bash
      npx wrangler secret delete ALLOW_DEV_SETUP
      ```

- [ ] Thêm một nhà, một phòng, một khách thuê thật rồi kiểm tra số liệu ở trang
      Tổng quan.

## 7b. Kiểm tra lịch chạy tự động

Bản build khai báo sẵn cron `0 1 * * *` — 08:00 giờ Việt Nam mỗi ngày — để rà
nhắc nợ. Sau khi deploy, xem trong bảng điều khiển: **Workers & Pages →
room-manager → Settings → Trigger Events**, phải thấy đúng lịch này.

Không cần chờ tới sáng mai mới biết chạy đúng hay không: mở trang **Nhắc nợ**
rồi bấm *Rà lại ngay*, nó gọi cùng một hàm mà cron gọi.

## 8. Tên miền riêng

*Chưa kiểm chứng — cần tài khoản Cloudflare có tên miền.*

Cách nhanh nhất là làm trong bảng điều khiển: **Workers & Pages → room-manager →
Settings → Domains & Routes → Add custom domain**, nhập ví dụ
`quanly.tenmien.vn`. Tên miền phải đang được Cloudflare quản lý DNS.

Cloudflare tự cấp chứng chỉ HTTPS. Cookie phiên tự bật cờ `Secure` khi chạy trên
HTTPS nên không cần đổi gì trong mã.

## 9. Sao lưu

D1 có sẵn **Time Travel**, giữ lại 30 ngày trên gói Free — khôi phục được về bất
kỳ thời điểm nào trong khoảng đó:

```bash
# Xem mốc khôi phục hiện có
npx wrangler d1 time-travel info room-manager

# Khôi phục về một thời điểm
npx wrangler d1 time-travel restore room-manager --timestamp=<ISO timestamp>
```

Thêm một bản sao lưu nằm ngoài Cloudflare, chạy hàng tuần:

```bash
npx wrangler d1 export room-manager --remote --output=backup-$(date +%F).sql
```

Bản sao lưu chưa từng thử phục hồi thì chưa thể coi là an toàn. Mỗi tháng nên
tạo một D1 tạm, nạp bản sao lưu vào đó và mở thử.

## 10. Cập nhật phiên bản sau này

```bash
npx wrangler d1 export room-manager --remote --output=backup-truoc-khi-cap-nhat.sql

CF_D1_DATABASE_NAME=room-manager CF_D1_DATABASE_ID=<id> npm run build
npm run deploy:migrate
npm run deploy
```

Nếu lần cập nhật có đổi schema, `npm run db:generate` phải được chạy **trước**
khi build để sinh file migration mới trong `drizzle/`.

Migration nào xóa cột hoặc xóa bảng thì đọc kỹ file SQL trước khi áp — D1 không
hoàn tác được, chỉ có Time Travel.

## Xử lý sự cố

**`Couldn't find a D1 DB with the name or binding 'DB'`**
Thiếu `--config dist/server/wrangler.json`. Các lệnh `wrangler d1` cần được chỉ
đúng file cấu hình do bước build sinh ra.

**`Found both a user configuration file ... and a deploy configuration file`**
Đang chạy lệnh từ trong `dist/`. Quay về thư mục gốc của dự án.

**Deploy xong nhưng trang báo lỗi cơ sở dữ liệu**
Bản build đang trỏ vào D1 giả. Kiểm tra bằng `npx wrangler deploy --dry-run`,
dòng cuối phải hiện đúng tên database của bạn.

**Đăng nhập báo sai mật khẩu dù chắc chắn đúng**
Có thể đã bị tạm khóa do nhập sai nhiều lần — 5 lần cho một cặp tài khoản và địa
chỉ IP trong 15 phút. Chờ hết 15 phút hoặc đăng nhập từ mạng khác.
