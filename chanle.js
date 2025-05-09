const { Random } = require('random-js');
const moment = require('moment');
const db = require('../database');
const config = require('../config');
const formatters = require('../utils/formatters');
const validators = require('../utils/validators');

// Create random number generator
const random = new Random();

// Play Chẵn Lẻ game
const playChanLe = async (user, bet, amount) => {
  // Validate bet
  bet = bet.toLowerCase();
  if (!validators.isValidChanLeBet(bet)) {
    return {
      success: false,
      message: '❌ Cược không hợp lệ. Vui lòng chọn "chan" hoặc "le".'
    };
  }
  
  // Validate bet amount
  if (!validators.isValidBetAmount(amount, 'CHANLE')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatters.formatCurrency(config.GAMES.CHANLE.MIN_BET)} đến ${formatters.formatCurrency(config.GAMES.CHANLE.MAX_BET)}.`
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
  db.pots.update('chanle', amount * 0.05); // 5% goes to pot
  
  // Generate random number
  const number = random.integer(1, 100);
  
  // Determine result
  const result = number % 2 === 0 ? 'chan' : 'le';
  
  // Calculate win amount
  let winAmount = 0;
  if (bet === result) {
    winAmount = Math.floor(amount * config.GAMES.CHANLE.MULTIPLIER);
    db.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatters.formatChanLeResult(number, result);
  const timestamp = formatters.formatTimestamp(new Date());
  
  // Save game result
  db.games.addResult('chanle', user.id, bet, amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    db.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Chẵn Lẻ: ${formattedResult}`
    );
  } else {
    db.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Chẵn Lẻ: ${bet}`
    );
  }
  
  // Create result message
  const resultBox = formatters.createGameResultBox(
    user,
    'Chẵn Lẻ',
    bet === 'chan' ? 'Chẵn' : 'Lẻ',
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
  playChanLe
};
