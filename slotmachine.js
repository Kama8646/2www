const { Random } = require('random-js');
const moment = require('moment');
const db = require('../database');
const config = require('../config');
const formatters = require('../utils/formatters');
const validators = require('../utils/validators');

// Create random number generator
const random = new Random();

// Slot machine symbols
const symbols = ['🍎', '🍊', '🍋', '🍒', '🍇', '💎', '7️⃣'];

// Play Slot Machine game
const playSlotMachine = async (user, amount) => {
  // Validate bet amount
  if (!validators.isValidBetAmount(amount, 'SLOTMACHINE')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatters.formatCurrency(config.GAMES.SLOTMACHINE.MIN_BET)} đến ${formatters.formatCurrency(config.GAMES.SLOTMACHINE.MAX_BET)}.`
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
  db.pots.update('slotmachine', amount * 0.05); // 5% goes to pot
  
  // Spin the slot machine
  const result = [
    symbols[random.integer(0, symbols.length - 1)],
    symbols[random.integer(0, symbols.length - 1)],
    symbols[random.integer(0, symbols.length - 1)]
  ];
  
  // Check for matches
  const unique = [...new Set(result)];
  
  // Calculate win amount
  let winAmount = 0;
  let winType = '';
  
  if (unique.length === 1) {
    // All three symbols are the same
    if (result[0] === '7️⃣') {
      // Jackpot
      winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.JACKPOT);
      winType = 'JACKPOT! 🎉';
    } else {
      // Three of a kind
      winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.THREE_SAME);
      winType = 'Ba ký tự giống nhau! 🎉';
    }
  } else if (unique.length === 2) {
    // Two symbols are the same
    winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.TWO_SAME);
    winType = 'Hai ký tự giống nhau! 🎉';
  }
  
  // Add winnings to user's balance
  if (winAmount > 0) {
    db.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatters.formatSlotResult(result);
  const timestamp = formatters.formatTimestamp(new Date());
  
  // Save game result
  db.games.addResult('slotmachine', user.id, 'slot', amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    db.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Slot Machine: ${formattedResult} - ${winType}`
    );
  } else {
    db.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Slot Machine`
    );
  }
  
  // Create result message
  let resultMessage = formatters.createGameResultBox(
    user,
    'Slot Machine',
    'Quay',
    amount,
    formattedResult + (winType ? ` - ${winType}` : ''),
    winAmount,
    timestamp
  );
  
  return {
    success: true,
    message: resultMessage,
    win: winAmount > 0,
    winAmount: winAmount
  };
};

module.exports = {
  playSlotMachine
};
