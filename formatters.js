const moment = require('moment');

// Format number with commas
const formatNumber = (number) => {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

// Format currency (VND)
const formatCurrency = (amount) => {
  return formatNumber(amount) + ' VNĐ';
};

// Format timestamp
const formatTimestamp = (timestamp) => {
  return moment(timestamp).format('HH:mm:ss DD-MM-YYYY');
};

// Emoji xúc xắc với các số điểm khác nhau
const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// Format game result for Tài Xỉu
const formatTaiXiuResult = (dice, result) => {
  const sum = dice.reduce((a, b) => a + b, 0);
  const diceWithEmojis = dice.map(num => `${diceEmojis[num-1]}`);
  return `🎲 ${dice[0]}-${dice[1]}-${dice[2]} = ${sum} | ${sum > 10 ? 'Tài ⚪️' : 'Xỉu ⚫️'}`;
};

// Format game result for Chẵn Lẻ
const formatChanLeResult = (number, result) => {
  return `🎲 ${number} | ${number % 2 === 0 ? 'Chẵn 🔴' : 'Lẻ 🔵'}`;
};

// Format game result for Đoán Số
const formatDoanSoResult = (number, userGuess) => {
  return `🎲 Kết quả: ${number} | Bạn đoán: ${userGuess} | ${number == userGuess ? 'ĐÚNG ✅' : 'SAI ❌'}`;
};

// Format game result for Slot Machine
const formatSlotResult = (symbols) => {
  // Đếm số lượng mỗi symbol để kiểm tra kết quả
  const counts = {};
  symbols.forEach(symbol => {
    counts[symbol] = (counts[symbol] || 0) + 1;
  });
  
  // Xác định kết quả
  let resultText = "";
  if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
    if (symbols[0] === '7️⃣') {
      resultText = "JACKPOT! 🎉🎉🎉";
    } else {
      resultText = "Ba giống nhau! 🎉";
    }
  } else if (symbols[0] === symbols[1] || symbols[1] === symbols[2] || symbols[0] === symbols[2]) {
    resultText = "Hai giống nhau! 🎉";
  } else {
    resultText = "Không trùng khớp ❌";
  }
  
  return `🎰 [ ${symbols.join(' | ')} ] 🎰 → ${resultText}`;
};

// Create boxed message for game results
const createGameResultBox = (user, game, bet, betAmount, result, winAmount, timestamp) => {
  return `┏━━━━━━━━━━━━━┓
┣➤ NGƯỜI CHƠI: ${user.first_name} ${user.username ? '@' + user.username : ''}
┣➤ CƯỢC: ${bet}
┣➤ TIỀN CƯỢC: ${formatCurrency(betAmount)}
┣➤ KẾT QUẢ: ${result}
┣➤ TIỀN THẮNG: ${formatCurrency(winAmount)}
┣➤ THỜI GIAN: ${timestamp}
┗━━━━━━━━━━━━━┛`;
};

module.exports = {
  formatNumber,
  formatCurrency,
  formatTimestamp,
  formatTaiXiuResult,
  formatChanLeResult,
  formatDoanSoResult,
  formatSlotResult,
  createGameResultBox
};
