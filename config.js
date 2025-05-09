require('dotenv').config();
const fs = require('fs');

// Hàm để cập nhật file .env
function updateEnvFile(key, value) {
  // Đọc file .env
  let envContent = fs.readFileSync('.env', 'utf8');
  
  // Kiểm tra xem key đã tồn tại chưa
  const regex = new RegExp(`^${key}=.*$`, 'm');
  
  if (regex.test(envContent)) {
    // Nếu key đã tồn tại, cập nhật giá trị
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    // Nếu key chưa tồn tại, thêm vào cuối file
    envContent += `\n${key}=${value}`;
  }
  
  // Ghi lại file .env
  fs.writeFileSync('.env', envContent);
  
  // Reload env
  require('dotenv').config();
}

// ==========================================================
// CẤU HÌNH - Chỉnh sửa các thông tin cài đặt tại đây
// ==========================================================

// Telegram Bot Token
const BOT_TOKEN = '7842939489:AAEaa5LIl3fyNVn53XnHHfcyCzSnj8aWZa8'; 

// Danh sách ID Admin (thêm các ID phân cách bằng dấu phẩy)
const ADMIN_LIST = ['6334711569']; 

// Danh sách ID chat được phép sử dụng bot (để trống nếu cho phép tất cả)
const ALLOWED_CHATS = []; 

// ==========================================================

module.exports = {
  // Telegram bot token
  TOKEN: BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
  
  // Admin user IDs
  ADMIN_IDS: ADMIN_LIST.length > 0 ? ADMIN_LIST : (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()),
  
  // Allowed Chat IDs 
  ALLOWED_CHAT_IDS: ALLOWED_CHATS.length > 0 ? ALLOWED_CHATS : (process.env.ALLOWED_CHAT_IDS || '').split(',').filter(id => id.trim() !== '').map(id => id.trim()),
  
  // Hàm cập nhật token
  updateToken: function(newToken) {
    updateEnvFile('TELEGRAM_BOT_TOKEN', newToken);
    this.TOKEN = newToken;
    return { success: true, message: '✅ Token đã được cập nhật thành công. Vui lòng khởi động lại bot.' };
  },
  
  // Hàm cập nhật admin IDs
  updateAdminIds: function(newAdminIds) {
    updateEnvFile('ADMIN_IDS', newAdminIds);
    this.ADMIN_IDS = newAdminIds.split(',').map(id => id.trim());
    return { success: true, message: '✅ ID của admin đã được cập nhật thành công.' };
  },
  
  // Hàm cập nhật allowed chat IDs
  updateAllowedChatIds: function(newChatIds) {
    updateEnvFile('ALLOWED_CHAT_IDS', newChatIds);
    this.ALLOWED_CHAT_IDS = newChatIds.split(',').filter(id => id.trim() !== '').map(id => id.trim());
    return { success: true, message: '✅ Danh sách chat được phép đã được cập nhật thành công.' };
  },
  
  // Game settings
  GAMES: {
    TAIXIU: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.8, // Win multiplier
    },
    TAIXIU_ROOM: {
      MIN_BET: 5000,
      MAX_BET: 1000000,
      MULTIPLIER_TAIXIU: 1.95, // Win multiplier for Tài/Xỉu
      MULTIPLIER_CHANLE: 1.90, // Win multiplier for Chẵn/Lẻ
      COUNTDOWN_TIME: 60, // Default countdown time in seconds
      POT_CONTRIBUTION: 0.05, // 5% of lost bets go to pot
    },
    CHANLE: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.9, // Win multiplier
    },
    DOANSO: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIER: 7, // Win multiplier
    },
    SLOTMACHINE: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIERS: {
        TWO_SAME: 1.5,
        THREE_SAME: 5,
        JACKPOT: 10,
      },
    },
  },
  
  // Daily check-in bonus amount
  DAILY_BONUS: 1000,
  
  // Initial balance for new users
  INITIAL_BALANCE: 10000,
  
  // Database file
  DB_FILE: 'database.json',
};
