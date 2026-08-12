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

### Để sau MVP

- Thanh toán cọc online, hóa đơn điện tử, gửi Zalo/SMS tự động.
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
