const { Random } = require('random-js');
const moment = require('moment');
const db = require('../database');
const config = require('../config');
const formatters = require('../utils/formatters');
const validators = require('../utils/validators');

// Create random number generator
const random = new Random();

// Play Đoán Số game
const playDoanSo = async (user, guess, amount) => {
  // Validate guess
  const numberGuess = parseInt(guess);
  if (isNaN(numberGuess) || numberGuess < 1 || numberGuess > 10) {
    return {
      success: false,
      message: '❌ Số đoán không hợp lệ. Vui lòng chọn số từ 1 đến 10.'
    };
  }
  
  // Validate bet amount
  if (!validators.isValidBetAmount(amount, 'DOANSO')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatters.formatCurrency(config.GAMES.DOANSO.MIN_BET)} đến ${formatters.formatCurrency(config.GAMES.DOANSO.MAX_BET)}.`
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
  db.pots.update('doanso', amount * 0.05); // 5% goes to pot
  
  // Generate random number
  const number = random.integer(1, 10);
  
  // Calculate win amount
  let winAmount = 0;
  if (numberGuess === number) {
    winAmount = Math.floor(amount * config.GAMES.DOANSO.MULTIPLIER);
    db.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatters.formatDoanSoResult(number, numberGuess);
  const timestamp = formatters.formatTimestamp(new Date());
  
  // Save game result
  db.games.addResult('doanso', user.id, numberGuess.toString(), amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    db.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Đoán Số: ${formattedResult}`
    );
  } else {
    db.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Đoán Số: ${numberGuess}`
    );
  }
  
  // Create result message
  const resultBox = formatters.createGameResultBox(
    user,
    'Đoán Số',
    numberGuess.toString(),
    amount,
    formattedResult,
    winAmount,
    timestamp
  );
  
  return {
    success: true,
    message: resultBox,
    win: numberGuess === number,
    winAmount: winAmount
  };
};

module.exports = {
  playDoanSo
};
