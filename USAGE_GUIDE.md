# Hướng dẫn sử dụng Bot Tài Xỉu

## Cài đặt và cấu hình

1. **Cấu hình trong file config.js:**
   ```javascript
   // Telegram Bot Token
   const BOT_TOKEN = 'your_token_here'; 

   // Danh sách ID Admin (thêm các ID phân cách bằng dấu phẩy)
   const ADMIN_LIST = ['id1', 'id2', 'id3']; 

   // Danh sách ID chat được phép sử dụng bot (để trống nếu cho phép tất cả)
   const ALLOWED_CHATS = ['chatid1', 'chatid2']; 
   ```

   - `BOT_TOKEN`: Token bot Telegram của bạn
   - `ADMIN_LIST`: Danh sách ID người dùng có quyền quản trị
   - `ALLOWED_CHATS`: Danh sách ID chat được phép sử dụng bot, để mảng rỗng nếu muốn cho phép tất cả

2. **Cài đặt và chạy:**
   ```
   npm install
   node main.js
   ```

## Lệnh dành cho người dùng

- **/start** - Bắt đầu sử dụng bot
- **/register** - Đăng ký tài khoản
- **/profile** - Xem thông tin tài khoản
- **/game** - Xem danh sách trò chơi
- **/diemdanh** - Điểm danh nhận thưởng hàng ngày
- **/giftcode [code]** - Nhập giftcode để nhận thưởng
- **/chatid** - Xem ID của chat hiện tại

## Các trò chơi

### Tài Xỉu
- **/taixiu [tai/xiu] [số tiền]** - Chơi Tài Xỉu
- **Luật chơi:** Tung 3 xúc xắc, tổng điểm > 10 là Tài, ≤ 10 là Xỉu
- **Rút gọn:** T [số tiền] hoặc X [số tiền]

### Chẵn Lẻ
- **/chanle [chan/le] [số tiền]** - Chơi Chẵn Lẻ
- **Luật chơi:** Tung số ngẫu nhiên 1-100, chia hết cho 2 là Chẵn, ngược lại là Lẻ
- **Rút gọn:** C [số tiền] hoặc L [số tiền]

### Đoán Số
- **/doanso [số 1-10] [số tiền]** - Chơi Đoán Số
- **Luật chơi:** Đoán đúng số ngẫu nhiên từ 1-10

### Slot Machine
- **/S [số tiền]** - Chơi Slot Machine
- **Luật chơi:** Quay 3 biểu tượng ngẫu nhiên, kết hợp giống nhau để nhận thưởng

### Phòng Tài Xỉu (chỉ hoạt động trong nhóm)
- **/taixiuroom** - Tạo phòng Tài Xỉu
- **Đặt cược:** 
  - /tx tai [số tiền] hoặc T [số tiền]
  - /tx xiu [số tiền] hoặc X [số tiền]
  - /tx chan [số tiền] hoặc C [số tiền]
  - /tx le [số tiền] hoặc L [số tiền]

## Lệnh dành cho Admin (có dấu hiệu 👑)

- **/addmoney [ID người dùng] [số tiền]** - Thêm tiền cho người dùng
- **/ban [ID người dùng] [lý do]** - Cấm người dùng
- **/unban [ID người dùng]** - Bỏ cấm người dùng
- **/creategiftcode [mã] [số tiền] [số lượt sử dụng]** - Tạo giftcode
- **/stats** - Xem thống kê hệ thống
- **/settings** - Xem cài đặt hiện tại

## Lưu ý
- Để thay đổi các cài đặt như token bot, admin IDs, và allowed chat IDs, hãy chỉnh sửa trực tiếp trong file config.js
- Sử dụng lệnh /chatid để lấy ID của chat hiện tại và thêm vào danh sách ALLOWED_CHATS (nếu muốn)