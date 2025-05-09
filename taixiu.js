const { Random } = require('random-js');
const moment = require('moment');
const db = require('../database');
const config = require('../config');
const formatters = require('../utils/formatters');
const validators = require('../utils/validators');

// Create random number generator
const random = new Random();

// Play Tài Xỉu game
const playTaiXiu = async (user, bet, amount) => {
  // Validate bet
  bet = bet.toLowerCase();
  if (!validators.isValidTaiXiuBet(bet)) {
    return {
      success: false,
      message: '❌ Cược không hợp lệ. Vui lòng chọn "tai" hoặc "xiu".'
    };
  }
  
  // Validate bet amount
  if (!validators.isValidBetAmount(amount, 'TAIXIU')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatters.formatCurrency(config.GAMES.TAIXIU.MIN_BET)} đến ${formatters.formatCurrency(config.GAMES.TAIXIU.MAX_BET)}.`
    };
  }
  
  // Check if user has enough balance
  if (!validators.hasEnoughBalance(user, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để đặt cược.'
    };
  }
  
  // Deduct bet amount from user's balance
  db.users.updateBalance(user.id, -amount);
  
  // Add to pot
  db.pots.update('taixiu', amount * 0.05); // 5% goes to pot
  
  // Roll dice
  const dice = [
    random.integer(1, 6),
    random.integer(1, 6),
    random.integer(1, 6)
  ];
  
  // Calculate sum
  const sum = dice.reduce((a, b) => a + b, 0);
  
  // Determine result
  const result = sum > 10 ? 'tai' : 'xiu';
  
  // Calculate win amount
  let winAmount = 0;
  if (bet === result) {
    winAmount = Math.floor(amount * config.GAMES.TAIXIU.MULTIPLIER);
    db.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatters.formatTaiXiuResult(dice, result);
  const timestamp = formatters.formatTimestamp(new Date());
  
  // Save game result
  db.games.addResult('taixiu', user.id, bet, amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    db.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Tài Xỉu: ${formattedResult}`
    );
  } else {
    db.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Tài Xỉu: ${bet}`
    );
  }
  
  // Create result message
  const resultBox = formatters.createGameResultBox(
    user,
    'Tài Xỉu',
    bet === 'tai' ? 'Tài' : 'Xỉu',
    amount,
    formattedResult,
    winAmount,
    timestamp
  );
  
  return {
    success: true,
    message: resultBox,
    win: bet === result,
    winAmount: winAmount
  };
};

module.exports = {
  playTaiXiu
};
