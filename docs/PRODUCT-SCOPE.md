# Định hướng sản phẩm trước khi triển khai

## Ý kiến chính

Với 2 nhà trọ × 20 phòng, nên làm một hệ thống duy nhất có bộ lọc theo nhà, không làm hai hệ thống tách biệt. Quy mô này chưa cần kiến trúc phức tạp; ưu tiên dữ liệu chính xác, thao tác nhanh trên điện thoại và sao lưu tốt.

Nên tách hai bề mặt:

1. **Trang quản trị riêng tư:** phòng, khách thuê, hợp đồng, đơn thu, phụ thu, công nợ và báo cáo.
2. **Trang đặt phòng công khai:** loại phòng, giá từ, tiện nghi, ảnh, phòng còn trống và biểu mẫu gửi yêu cầu.

Trang công khai không được hiển thị tên khách thuê, số điện thoại, số tiền nợ hoặc mã hợp đồng. “Đặt phòng” trong MVP nên là **gửi yêu cầu + chủ nhà xác nhận**, chưa phải đặt tức thời. Cách này tránh hai khách cùng giữ một phòng và phù hợp khi chưa tích hợp thanh toán cọc.

## Phạm vi MVP khuyến nghị

### Bắt buộc

- Quản lý nhà, tầng, loại phòng và từng phòng.
- Trạng thái phòng: trống, giữ chỗ, đang thuê, bảo trì.
- Hồ sơ khách thuê và hợp đồng.
- Lập đơn theo kỳ; mỗi đơn có tiền phòng và nhiều dòng phụ thu.
- Ghi nhận thanh toán một phần hoặc toàn phần; theo dõi số còn nợ.
- Quản lý chỉ số điện/nước và đơn giá tại thời điểm chốt.
- Danh sách yêu cầu đặt phòng, xác nhận hoặc từ chối.
- Dashboard công suất, doanh thu đã thu và công nợ.
- Nhật ký ai đã sửa dữ liệu quan trọng.

### Không làm

**Phần mềm không đụng tới tiền thật.** Không cổng thanh toán, không chuyển
khoản online, không kết nối ngân hàng. Nó là sổ theo dõi: người dùng nhập số
liệu, phần mềm tính công nợ và trình bày cho dễ nhìn. Tiền vẫn chuyển qua kênh
sẵn có của chủ nhà.

Ràng buộc này đang đúng với mã nguồn: không có một lệnh gọi ra ngoài Internet
nào trong `db/`, `app/api/` hay `worker/`. Giữ nguyên như vậy.

Hệ quả cho việc đánh giá rủi ro: lỗi ở luồng ghi nhận thanh toán làm **sai số
liệu**, không làm **mất tiền**. Vẫn phải sửa — con số đúng chính là sản phẩm —
nhưng đừng xếp ngang hàng với sự cố của một hệ thống thanh toán.

### Để sau MVP

- **Mã QR chuyển khoản** in trên đơn thu, để khách quét bằng app ngân hàng.
  Sinh hoàn toàn ngoại tuyến từ số tài khoản của chủ nhà, không gọi API ngân
  hàng nào, nên vẫn nằm trong ràng buộc "không đụng tới tiền thật".
  `db/qr.ts` đã có sẵn và chạy được trong Workers.
- Hóa đơn điện tử, gửi Zalo/SMS tự động.
- Ứng dụng di động native; web responsive đã đủ cho giai đoạn đầu.
- Kế toán kép, phân quyền phức tạp, AI định giá phòng.
- Đồng bộ khóa cửa, công tơ IoT hoặc nhiều kênh đặt phòng.

## Các quyết định nên chốt trước khi nối dữ liệu

- Chu kỳ thu: theo ngày vào ở hay chốt cùng một ngày hàng tháng.
- Điện/nước: theo đồng hồ hay định mức đầu người; đơn giá có thay đổi theo nhà không.
- Cọc giữ phòng tồn tại bao lâu và điều kiện hoàn/hủy.
- Một khách có thể đứng tên nhiều phòng/hợp đồng hay không.
- Doanh thu được tính khi phát hành đơn hay khi thực thu. Khuyến nghị dashboard hiển thị cả **phải thu** và **đã thu**, không gộp hai khái niệm.

## Lộ trình

1. **Nền tảng:** đăng nhập, cơ sở dữ liệu, quản lý nhà/phòng/khách/hợp đồng.
2. **Tài chính vận hành:** đơn thu, phụ thu, thanh toán, công nợ, xuất Excel/PDF.
3. **Đặt phòng:** trang công khai, lịch trống, yêu cầu và xác nhận.
4. **Tự động hóa:** nhắc nợ, thông báo, cọc online, báo cáo nâng cao.

Mỗi giai đoạn nên chạy thử bằng dữ liệu thật của một nhà trong 1–2 tuần rồi mới áp dụng cho nhà còn lại.
