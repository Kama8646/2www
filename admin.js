const db = require('../database');
const validators = require('../utils/validators');
const formatters = require('../utils/formatters');
const config = require('../config');

// Add money to user's balance
const addMoney = async (adminId, targetId, amount) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Check if amount is valid
  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      message: '❌ Số tiền không hợp lệ.'
    };
  }
  
  // Check if target user exists
  const targetUser = db.users.get(targetId);
  if (!targetUser) {
    return {
      success: false,
      message: '❌ Người dùng không tồn tại.'
    };
  }
  
  // Add money to user's balance
  db.users.updateBalance(targetId, amount);
  
  // Create transaction record
  db.transactions.add(
    targetId,
    'admin',
    amount,
    `Admin thêm tiền vào tài khoản`
  );
  
  return {
    success: true,
    message: `✅ Đã thêm ${formatters.formatCurrency(amount)} vào tài khoản của ${targetUser.first_name}.`
  };
};

// Ban user
const banUser = async (adminId, targetId, reason = 'Vi phạm điều khoản sử dụng') => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Check if target user exists
  const targetUser = db.users.get(targetId);
  if (!targetUser) {
    return {
      success: false,
      message: '❌ Người dùng không tồn tại.'
    };
  }
  
  // Ban user
  db.users.banUser(targetId, true);
  
  return {
    success: true,
    message: `✅ Đã cấm người dùng ${targetUser.first_name}.\nLý do: ${reason}`
  };
};

// Unban user
const unbanUser = async (adminId, targetId) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Check if target user exists
  const targetUser = db.users.get(targetId);
  if (!targetUser) {
    return {
      success: false,
      message: '❌ Người dùng không tồn tại.'
    };
  }
  
  // Unban user
  db.users.banUser(targetId, false);
  
  return {
    success: true,
    message: `✅ Đã bỏ cấm người dùng ${targetUser.first_name}.`
  };
};

// Create giftcode
const createGiftcode = async (adminId, code, amount, maxUses) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Check if amount is valid
  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      message: '❌ Số tiền không hợp lệ.'
    };
  }
  
  // Check if maxUses is valid
  if (isNaN(maxUses) || maxUses < 0) {
    return {
      success: false,
      message: '❌ Số lượt sử dụng không hợp lệ.'
    };
  }
  
  // Create giftcode
  const giftcode = db.giftcodes.create(code, amount, maxUses);
  
  return {
    success: true,
    message: `✅ Đã tạo giftcode: ${code}\nSố tiền: ${formatters.formatCurrency(amount)}\nLượt sử dụng tối đa: ${maxUses === 0 ? 'Không giới hạn' : maxUses}`
  };
};

// Get system stats
const getStats = async (adminId) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Get stats
  const users = db.users.getTop(100);
  const totalUsers = users.length;
  const totalBanned = users.filter(user => user.banned).length;
  const totalBalance = users.reduce((sum, user) => sum + user.balance, 0);
  const totalBet = users.reduce((sum, user) => sum + user.totalBet, 0);
  
  // Get pot stats
  const taixiuPot = db.pots.get('taixiu');
  const chanlePot = db.pots.get('chanle');
  const doansoPot = db.pots.get('doanso');
  const slotmachinePot = db.pots.get('slotmachine');
  const totalPot = taixiuPot + chanlePot + doansoPot + slotmachinePot;
  
  // Create message
  const message = `📊 THỐNG KÊ HỆ THỐNG

👥 Tổng số người dùng: ${totalUsers}
🚫 Tổng số người bị cấm: ${totalBanned}
💰 Tổng số dư: ${formatters.formatCurrency(totalBalance)}
🎮 Tổng tiền cược: ${formatters.formatCurrency(totalBet)}

🏆 THÔNG TIN HŨ
- Tài Xỉu: ${formatters.formatCurrency(taixiuPot)}
- Chẵn Lẻ: ${formatters.formatCurrency(chanlePot)}
- Đoán Số: ${formatters.formatCurrency(doansoPot)}
- Slot Machine: ${formatters.formatCurrency(slotmachinePot)}
- Tổng: ${formatters.formatCurrency(totalPot)}`;

  return {
    success: true,
    message: message
  };
};

// Cập nhật token
const updateToken = async (adminId, newToken) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  if (!newToken || newToken.trim() === '') {
    return {
      success: false,
      message: '❌ Token không hợp lệ.'
    };
  }
  
  return config.updateToken(newToken);
};

// Cập nhật admin IDs
const updateAdminIds = async (adminId, newAdminIds) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  if (!newAdminIds || newAdminIds.trim() === '') {
    return {
      success: false,
      message: '❌ Danh sách ID admin không hợp lệ.'
    };
  }
  
  // Kiểm tra nếu ID của admin hiện tại không nằm trong danh sách mới
  const currentAdminId = adminId.toString();
  const newAdminIdsArray = newAdminIds.split(',').map(id => id.trim());
  
  if (!newAdminIdsArray.includes(currentAdminId)) {
    // Thêm ID của admin hiện tại vào danh sách để tránh bị khóa
    newAdminIds = `${newAdminIds},${currentAdminId}`;
  }
  
  return config.updateAdminIds(newAdminIds);
};

// Cập nhật allowed chat IDs
const updateAllowedChatIds = async (adminId, newChatIds) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  return config.updateAllowedChatIds(newChatIds);
};

// Lấy thông tin cài đặt hiện tại
const getSettings = async (adminId) => {
  // Check if user is admin
  if (!validators.isAdmin(adminId)) {
    return {
      success: false,
      message: '❌ Bạn không có quyền sử dụng lệnh này.'
    };
  }
  
  // Lấy thông tin cài đặt hiện tại
  const settings = {
    token: config.TOKEN ? `${config.TOKEN.substring(0, 8)}...` : 'Chưa cài đặt',
    adminIds: config.ADMIN_IDS.join(', ') || 'Chưa cài đặt',
    allowedChatIds: config.ALLOWED_CHAT_IDS.length > 0 ? 
      config.ALLOWED_CHAT_IDS.join(', ') : 
      'Chưa giới hạn (cho phép tất cả)'
  };
  
  const message = `⚙️ CÀI ĐẶT HIỆN TẠI

🔑 Bot Token: ${settings.token}
👑 Admin IDs: ${settings.adminIds}
💬 Chat IDs được cho phép: ${settings.allowedChatIds}

Để cập nhật cài đặt, sử dụng các lệnh sau:
/settoken [token] - Cập nhật token mới
/setadmins [id1,id2,...] - Cập nhật danh sách admin
/setchats [id1,id2,...] - Cập nhật danh sách chat được phép
`;
  
  return {
    success: true,
    message: message
  };
};

module.exports = {
  addMoney,
  banUser,
  unbanUser,
  createGiftcode,
  getStats,
  updateToken,
  updateAdminIds,
  updateAllowedChatIds,
  getSettings
};
