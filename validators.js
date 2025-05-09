const config = require('../config');

// Check if user is admin
const isAdmin = (userId) => {
  return config.ADMIN_IDS.includes(userId.toString());
};

// Check if chat is allowed
const isChatAllowed = (chatId) => {
  // Nếu không có chat ID nào được đặt, cho phép tất cả
  if (config.ALLOWED_CHAT_IDS.length === 0) {
    return true;
  }
  
  return config.ALLOWED_CHAT_IDS.includes(chatId.toString());
};

// Check if bet amount is valid
const isValidBetAmount = (amount, gameType) => {
  const game = config.GAMES[gameType.toUpperCase()];
  
  if (!game) return false;
  
  return amount >= game.MIN_BET && amount <= game.MAX_BET;
};

// Check if user has enough balance
const hasEnoughBalance = (user, amount) => {
  return user.balance >= amount;
};

// Validate tài xỉu bet
const isValidTaiXiuBet = (bet) => {
  return ['tai', 'xiu'].includes(bet.toLowerCase());
};

// Validate chẵn lẻ bet
const isValidChanLeBet = (bet) => {
  return ['chan', 'le'].includes(bet.toLowerCase());
};

// Validate đoán số bet
const isValidDoanSoBet = (bet) => {
  const num = parseInt(bet);
  return !isNaN(num) && num >= 1 && num <= 10;
};

// Check if user can claim daily bonus
const canClaimDailyBonus = (user) => {
  if (!user.lastCheckin) return true;
  
  const today = new Date().toISOString().split('T')[0];
  return user.lastCheckin !== today;
};

module.exports = {
  isAdmin,
  isChatAllowed,
  isValidBetAmount,
  hasEnoughBalance,
  isValidTaiXiuBet,
  isValidChanLeBet,
  isValidDoanSoBet,
  canClaimDailyBonus
};
