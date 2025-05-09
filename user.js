const db = require('../database');
const validators = require('../utils/validators');
const formatters = require('../utils/formatters');
const config = require('../config');
const moment = require('moment');

// Register a new user
const register = async (user) => {
  // Check if user already exists
  if (db.users.exists(user.id)) {
    return {
      success: false,
      message: '❌ Bạn đã đăng ký tài khoản rồi.'
    };
  }
  
  // Create new user
  const newUser = db.users.create(user);
  
  return {
    success: true,
    message: `✅ Đăng ký thành công!\n\n👤 ID: ${newUser.id}\n💰 Số dư: ${formatters.formatCurrency(newUser.balance)}\n📅 Ngày đăng ký: ${newUser.registered}`
  };
};

// Get user profile
const getProfile = async (userId) => {
  // Check if user exists
  const user = db.users.get(userId);
  if (!user) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
    };
  }
  
  // Check if user is banned
  if (user.banned) {
    return {
      success: false,
      message: '❌ Tài khoản của bạn đã bị cấm.'
    };
  }
  
  // Get user's game history
  const games = db.games.getUserGames(userId, 5);
  const transactions = db.transactions.getUserTransactions(userId, 5);
  
  // Create message
  const message = `👤 THÔNG TIN TÀI KHOẢN

🆔 ID: ${user.id}
👤 Tên: ${user.first_name} ${user.last_name || ''}
${user.username ? `🔖 Username: @${user.username}` : ''}
💰 Số dư: ${formatters.formatCurrency(user.balance)}
🎮 Tổng tiền cược: ${formatters.formatCurrency(user.totalBet)}
📅 Ngày đăng ký: ${user.registered}
${user.lastCheckin ? `📌 Điểm danh gần nhất: ${user.lastCheckin}` : '📌 Chưa điểm danh lần nào'}

🎮 LỊCH SỬ CHƠI GẦN ĐÂY
${games.length > 0 ? games.map(game => `- ${game.gameType.toUpperCase()}: ${game.result} | ${formatters.formatCurrency(game.winAmount)} | ${game.timestamp}`).join('\n') : 'Chưa có lịch sử chơi'}

💳 GIAO DỊCH GẦN ĐÂY
${transactions.length > 0 ? transactions.map(tx => `- ${tx.type.toUpperCase()}: ${tx.amount > 0 ? '+' : ''}${formatters.formatCurrency(tx.amount)} | ${tx.timestamp}`).join('\n') : 'Chưa có giao dịch'}`;

  return {
    success: true,
    message: message
  };
};

// View money of other user
const viewUserMoney = async (requesterId, targetUsername) => {
  // Check if requester exists
  const requester = db.users.get(requesterId);
  if (!requester) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
    };
  }
  
  // Check if requester is banned
  if (requester.banned) {
    return {
      success: false,
      message: '❌ Tài khoản của bạn đã bị cấm.'
    };
  }
  
  // Find target user by username
  targetUsername = targetUsername.replace('@', '');
  const allUsers = db.users.getTop(1000); // Get all users
  const targetUser = allUsers.find(u => u.username && u.username.toLowerCase() === targetUsername.toLowerCase());
  
  if (!targetUser) {
    return {
      success: false,
      message: '❌ Không tìm thấy người dùng.'
    };
  }
  
  return {
    success: true,
    message: `👤 ${targetUser.first_name} ${targetUser.last_name || ''} (@${targetUser.username})\n💰 Số dư: ${formatters.formatCurrency(targetUser.balance)}`
  };
};

// Transfer money to another user
const transferMoney = async (senderId, targetUsername, amount) => {
  // Check if sender exists
  const sender = db.users.get(senderId);
  if (!sender) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
    };
  }
  
  // Check if sender is banned
  if (sender.banned) {
    return {
      success: false,
      message: '❌ Tài khoản của bạn đã bị cấm.'
    };
  }
  
  // Check if amount is valid
  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      message: '❌ Số tiền không hợp lệ.'
    };
  }
  
  // Check if sender has enough balance
  if (!validators.hasEnoughBalance(sender, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để chuyển tiền.'
    };
  }
  
  // Find target user by username
  targetUsername = targetUsername.replace('@', '');
  const allUsers = db.users.getTop(1000); // Get all users
  const targetUser = allUsers.find(u => u.username && u.username.toLowerCase() === targetUsername.toLowerCase());
  
  if (!targetUser) {
    return {
      success: false,
      message: '❌ Không tìm thấy người dùng.'
    };
  }
  
  // Check if target is banned
  if (targetUser.banned) {
    return {
      success: false,
      message: '❌ Người nhận đã bị cấm.'
    };
  }
  
  // Transfer money
  db.users.updateBalance(senderId, -amount);
  db.users.updateBalance(targetUser.id, amount);
  
  // Create transaction records
  db.transactions.add(
    senderId,
    'transfer_out',
    -amount,
    `Chuyển tiền cho @${targetUser.username}`
  );
  
  db.transactions.add(
    targetUser.id,
    'transfer_in',
    amount,
    `Nhận tiền từ @${sender.username || senderId}`
  );
  
  return {
    success: true,
    message: `✅ Đã chuyển ${formatters.formatCurrency(amount)} cho ${targetUser.first_name} (@${targetUser.username}).\n💰 Số dư hiện tại: ${formatters.formatCurrency(sender.balance - amount)}`
  };
};

// Delete user account
const deleteAccount = async (userId) => {
  // Check if user exists
  const user = db.users.get(userId);
  if (!user) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản.'
    };
  }
  
  // Delete user account
  db.users.delete(userId);
  
  return {
    success: true,
    message: `✅ Đã xóa tài khoản của bạn.\nCảm ơn bạn đã sử dụng dịch vụ.`
  };
};

// Daily check-in
const dailyCheckin = async (userId) => {
  // Check if user exists
  const user = db.users.get(userId);
  if (!user) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
    };
  }
  
  // Check if user is banned
  if (user.banned) {
    return {
      success: false,
      message: '❌ Tài khoản của bạn đã bị cấm.'
    };
  }
  
  // Check if user can claim daily bonus
  if (!validators.canClaimDailyBonus(user)) {
    return {
      success: false,
      message: '❌ Bạn đã điểm danh hôm nay rồi. Vui lòng quay lại vào ngày mai.'
    };
  }
  
  // Update user's last check-in time
  db.users.updateCheckin(userId);
  
  // Add bonus to user's balance
  db.users.updateBalance(userId, config.DAILY_BONUS);
  
  // Create transaction record
  db.transactions.add(
    userId,
    'daily',
    config.DAILY_BONUS,
    `Nhận thưởng điểm danh hàng ngày`
  );
  
  return {
    success: true,
    message: `✅ Điểm danh thành công!\n💰 Bạn đã nhận được ${formatters.formatCurrency(config.DAILY_BONUS)}.\n💰 Số dư hiện tại: ${formatters.formatCurrency(user.balance + config.DAILY_BONUS)}`
  };
};

// Use giftcode
const useGiftcode = async (userId, code) => {
  // Check if user exists
  const user = db.users.get(userId);
  if (!user) {
    return {
      success: false,
      message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
    };
  }
  
  // Check if user is banned
  if (user.banned) {
    return {
      success: false,
      message: '❌ Tài khoản của bạn đã bị cấm.'
    };
  }
  
  // Use giftcode
  const amount = db.giftcodes.use(code, userId);
  
  if (amount === null) {
    return {
      success: false,
      message: '❌ Giftcode không tồn tại.'
    };
  }
  
  if (amount === false) {
    return {
      success: false,
      message: '❌ Bạn đã sử dụng giftcode này rồi hoặc giftcode đã hết lượt sử dụng.'
    };
  }
  
  // Add amount to user's balance
  db.users.updateBalance(userId, amount);
  
  // Create transaction record
  db.transactions.add(
    userId,
    'giftcode',
    amount,
    `Sử dụng giftcode: ${code}`
  );
  
  return {
    success: true,
    message: `✅ Đã sử dụng giftcode thành công!\n💰 Bạn đã nhận được ${formatters.formatCurrency(amount)}.\n💰 Số dư hiện tại: ${formatters.formatCurrency(user.balance + amount)}`
  };
};

// Get leaderboard
const getLeaderboard = async () => {
  // Get top 10 users by balance
  const topUsers = db.users.getTop(10);
  
  if (topUsers.length === 0) {
    return {
      success: false,
      message: '❌ Chưa có người dùng nào đăng ký.'
    };
  }
  
  // Create message
  let message = '🏆 BẢNG XẾP HẠNG ĐẠI GIA 🏆\n\n';
  
  topUsers.forEach((user, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    message += `${medal} ${user.first_name} ${user.username ? `(@${user.username})` : ''}: ${formatters.formatCurrency(user.balance)}\n`;
  });
  
  return {
    success: true,
    message: message
  };
};

// Get pot amount
const getPot = async () => {
  // Get pot amounts
  const taixiuPot = db.pots.get('taixiu');
  const chanlePot = db.pots.get('chanle');
  const doansoPot = db.pots.get('doanso');
  const slotmachinePot = db.pots.get('slotmachine');
  const totalPot = taixiuPot + chanlePot + doansoPot + slotmachinePot;
  
  // Create message
  const message = `🏆 THÔNG TIN HŨ 🏆

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

// Get games list
const getGamesList = async () => {
  // Create message
  const message = `🎮 DANH SÁCH CÁC GAME 🎮

1. 🎲 Tài Xỉu (/taixiu)
   - Dự đoán tổng của 3 xúc xắc
   - Dưới 10 là Xỉu, trên 10 là Tài
   - Tỷ lệ thắng: 1.8 lần tiền cược

2. 🎮 Chẵn Lẻ (/chanle)
   - Dự đoán số chẵn hoặc lẻ
   - Tỷ lệ thắng: 1.9 lần tiền cược

3. 🔢 Đoán Số (/doanso)
   - Dự đoán số từ 1 đến 10
   - Tỷ lệ thắng: 7 lần tiền cược

4. 🎰 Slot Machine (/S)
   - Quay slot machine
   - Hai ký tự giống nhau: 1.5 lần tiền cược
   - Ba ký tự giống nhau: 5 lần tiền cược
   - Jackpot (777): 10 lần tiền cược

Cách chơi: Gõ lệnh tương ứng với từng game để bắt đầu.`;

  return {
    success: true,
    message: message
  };
};

module.exports = {
  register,
  getProfile,
  viewUserMoney,
  transferMoney,
  deleteAccount,
  dailyCheckin,
  useGiftcode,
  getLeaderboard,
  getPot,
  getGamesList
};
