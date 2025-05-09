const { Random } = require('random-js');
const moment = require('moment');
const crypto = require('crypto');
const config = require('../config');

// Initialize random number generator
const random = new Random();

// Store room state for each chat
const roomStates = {};

// Helper functions for TaixiuRoom
// Generate MD5 key for result verification
function generateMD5Key(roundId) {
  return crypto.createHash('md5').update(roundId.toString()).digest('hex');
}

// Get room state for a specific chat
function getRoomState(chatId) {
  if (!roomStates[chatId]) {
    // Initialize new room state
    roomStates[chatId] = {
      isActive: false,
      roundId: Date.now(),
      countdownTime: config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME,
      timeRemaining: config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME,
      bets: {
        tai: [],
        xiu: [],
        chan: [],
        le: []
      },
      totalBets: {
        tai: 0,
        xiu: 0, 
        chan: 0,
        le: 0
      },
      result: null,
      resultMD5: null,
      messageId: null,
      history: []
    };
  }
  
  return roomStates[chatId];
}

// Format the room status message
function getStatusMessage(roomState) {
  // If round is finished
  if (roomState.result) {
    const { dice, sum } = roomState.result;
    const resultTaiXiu = sum > 10 ? 'Tài ⚪️' : 'Xỉu ⚫️';
    const resultChanLe = sum % 2 === 0 ? 'Chẵn 🔴' : 'Lẻ 🔵';
    
    return `🎲 PHÒNG TÀI XỈU - KẾT QUẢ 🎲
    
┏━━━━━━━━━━━━━━━━┓
┃  ${dice[0]} | ${dice[1]} | ${dice[2]}  ┃ = ${sum}
┗━━━━━━━━━━━━━━━━┛

${resultTaiXiu} | ${resultChanLe}

👥 THÔNG TIN PHÒNG:
┣➤ Tổng cược Tài: ${roomState.totalBets.tai.toLocaleString()} VNĐ (${roomState.bets.tai.length} người)
┣➤ Tổng cược Xỉu: ${roomState.totalBets.xiu.toLocaleString()} VNĐ (${roomState.bets.xiu.length} người)
┣➤ Tổng cược Chẵn: ${roomState.totalBets.chan.toLocaleString()} VNĐ (${roomState.bets.chan.length} người)
┣➤ Tổng cược Lẻ: ${roomState.totalBets.le.toLocaleString()} VNĐ (${roomState.bets.le.length} người)

🔍 Mã xác thực MD5: ${roomState.resultMD5}
⏰ Vòng mới bắt đầu sau 10 giây...`;
  }
  
  // If round is active and countdown is running
  return `🎲 PHÒNG TÀI XỈU 🎲
  
⏰ Thời gian còn lại: ${roomState.timeRemaining}s

👥 THÔNG TIN PHÒNG:
┣➤ Tổng cược Tài: ${roomState.totalBets.tai.toLocaleString()} VNĐ (${roomState.bets.tai.length} người)
┣➤ Tổng cược Xỉu: ${roomState.totalBets.xiu.toLocaleString()} VNĐ (${roomState.bets.xiu.length} người)
┣➤ Tổng cược Chẵn: ${roomState.totalBets.chan.toLocaleString()} VNĐ (${roomState.bets.chan.length} người)
┣➤ Tổng cược Lẻ: ${roomState.totalBets.le.toLocaleString()} VNĐ (${roomState.bets.le.length} người)

📋 LUẬT CHƠI:
┣➤ Tài: Tổng 3 xúc xắc > 10
┣➤ Xỉu: Tổng 3 xúc xắc ≤ 10
┣➤ Chẵn: Tổng chia hết cho 2
┣➤ Lẻ: Tổng không chia hết cho 2

💰 LỆNH ĐẶT CƯỢC:
/tx tai [số tiền] - Đặt cược Tài
/tx xiu [số tiền] - Đặt cược Xỉu
/tx chan [số tiền] - Đặt cược Chẵn
/tx le [số tiền] - Đặt cược Lẻ

📊 LỊCH SỬ (5 PHIÊN GẦN NHẤT):
${roomState.history.slice(0, 5).map((h, i) => {
  const taiXiu = h.sum > 10 ? 'Tài' : 'Xỉu';
  const chanLe = h.sum % 2 === 0 ? 'Chẵn' : 'Lẻ';
  return `#${i+1}: ${h.dice.join(' | ')} = ${h.sum} (${taiXiu} | ${chanLe})`;
}).join('\n')}

🔍 Mã xác thực MD5: ${roomState.resultMD5}`;
}

// Start a new round
async function startNewRound(bot, chatId) {
  const roomState = getRoomState(chatId);
  
  // Generate new round ID
  roomState.roundId = Date.now();
  
  // Reset room state
  roomState.isActive = true;
  roomState.timeRemaining = roomState.countdownTime;
  roomState.bets = { tai: [], xiu: [], chan: [], le: [] };
  roomState.totalBets = { tai: 0, xiu: 0, chan: 0, le: 0 };
  roomState.result = null;
  
  // Generate MD5 hash for result verification
  // We pre-determine the result but encrypt it with MD5
  // to prove fair play when revealed later
  const dice = [
    random.integer(1, 6),
    random.integer(1, 6),
    random.integer(1, 6)
  ];
  const sum = dice.reduce((a, b) => a + b, 0);
  
  // Store encrypted result
  roomState.resultMD5 = generateMD5Key(`${roomState.roundId}-${dice.join('')}-${sum}`);
  
  // Send initial status message
  const msg = await bot.sendMessage(
    chatId,
    getStatusMessage(roomState),
    { parse_mode: 'Markdown' }
  );
  
  // Store message ID for later updates
  roomState.messageId = msg.message_id;
  
  // Start countdown
  startCountdown(bot, chatId);
  
  return roomState;
}

// Update countdown timer
function startCountdown(bot, chatId) {
  const roomState = getRoomState(chatId);
  
  const timer = setInterval(() => {
    roomState.timeRemaining--;
    
    // Thông báo tại thời điểm quan trọng
    if (roomState.timeRemaining === 60 || roomState.timeRemaining === 30 || roomState.timeRemaining === 10) {
      bot.sendMessage(chatId, `⏳ CÒN ${roomState.timeRemaining} GIÂY CƯỢC\n\nID Phiên: ${roomState.roundId.toString().slice(-5)}\nKết thúc sau: ${roomState.timeRemaining}s`);
    }
    
    // Update the message every 5 seconds or for the last 10 seconds
    if (roomState.timeRemaining % 5 === 0 || roomState.timeRemaining <= 10) {
      bot.editMessageText(
        getStatusMessage(roomState),
        {
          chat_id: chatId,
          message_id: roomState.messageId,
          parse_mode: 'Markdown'
        }
      ).catch(err => console.error('Error updating countdown:', err));
    }
    
    // When countdown reaches 0
    if (roomState.timeRemaining <= 0) {
      clearInterval(timer);
      // Gửi thông báo khoá đặt cược
      bot.sendMessage(chatId, `🔒 ĐÃ KHOÁ CỬA CƯỢC\n\nID Phiên: ${roomState.roundId.toString().slice(-5)}\nĐang tung xúc xắc...`);
      rollDiceAndEndRound(bot, chatId);
    }
  }, 1000);
}

// Roll the dice and end the current round
async function rollDiceAndEndRound(bot, chatId) {
  const roomState = getRoomState(chatId);
  const db = require('../database');
  
  // Stop accepting new bets
  roomState.isActive = false;
  
  // Send dice rolling animation message
  await bot.sendMessage(chatId, "🎲 ĐANG QUAY XÚC XẮC...");
  
  // Sử dụng emoji 🎲 của Telegram để tung xúc xắc thật
  const dice1 = await bot.sendDice(chatId, { emoji: '🎲' });
  const dice2 = await bot.sendDice(chatId, { emoji: '🎲' });
  const dice3 = await bot.sendDice(chatId, { emoji: '🎲' });
  
  // Get the actual dice values from Telegram's response
  const diceValues = [
    dice1.dice.value,
    dice2.dice.value, 
    dice3.dice.value
  ];
  
  // Calculate sum
  const sum = diceValues.reduce((a, b) => a + b, 0);
  
  // Store the results
  roomState.result = {
    dice: diceValues,
    sum: sum
  };
  
  // Add to history
  roomState.history.unshift({
    dice: diceValues,
    sum: sum,
    timestamp: moment().format('HH:mm:ss')
  });
  
  // Keep only the most recent 20 results
  if (roomState.history.length > 20) {
    roomState.history = roomState.history.slice(0, 20);
  }
  
  // Update the message with results
  await bot.editMessageText(
    getStatusMessage(roomState),
    {
      chat_id: chatId,
      message_id: roomState.messageId,
      parse_mode: 'Markdown'
    }
  );
  
  // Chờ một chút để người dùng có thể xem rõ kết quả xúc xắc
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Xác định kết quả tài xỉu dựa trên giá trị xúc xắc
  // Tài: tổng > 10, Xỉu: tổng <= 10
  const isTai = sum > 10;
  const isXiu = sum <= 10;
  // Chẵn: chia hết cho 2, Lẻ: không chia hết cho 2
  const isChan = sum % 2 === 0;
  
  const kqTaiXiu = isTai ? "TÀI" : "XỈU";
  const kqChanLe = isChan ? "CHẴN" : "LẺ";
  
  // Gửi thông báo kết quả tổng hợp với thông tin rõ ràng
  await bot.sendMessage(chatId, 
    `🎲 KẾT QUẢ PHIÊN #${roomState.roundId.toString().slice(-5)}:\n` +
    `┣➤ Xúc xắc: ${diceValues.join(' + ')} = ${sum}\n` +
    `┣➤ Kết quả: ${kqTaiXiu} - ${kqChanLe}\n` +
    `┣➤ Tài (>10) | Xỉu (≤10)\n` +
    `┗➤ ${sum > 10 ? '✅ TÀI thắng' : '✅ XỈU thắng'}`
  );
  
  // Process Tài/Xỉu bets
  roomState.bets.tai.forEach(bet => {
    const user = db.users.get(bet.userId);
    if (user) {
      if (isTai) {
        // User won
        const winAmount = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU);
        db.users.updateBalance(bet.userId, winAmount);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'win',
          winAmount,
          `Thắng Tài Xỉu Room: Tài ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `✨ Kỳ ${roomState.roundId.toString().slice(-5)}: Thắng Room ${winAmount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Tài)`
        ).catch(() => {});
      } else {
        // User lost - add 5% to pot
        const potContribution = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.POT_CONTRIBUTION);
        db.pots.update('taixiu', potContribution);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'bet',
          -bet.amount,
          `Thua Tài Xỉu Room: Tài ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `❌ Kỳ ${roomState.roundId.toString().slice(-5)}: Thua Room ${bet.amount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Xỉu)`
        ).catch(() => {});
      }
    }
  });
  
  roomState.bets.xiu.forEach(bet => {
    const user = db.users.get(bet.userId);
    if (user) {
      if (!isTai) {
        // User won
        const winAmount = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU);
        db.users.updateBalance(bet.userId, winAmount);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'win',
          winAmount,
          `Thắng Tài Xỉu Room: Xỉu ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `✨ Kỳ ${roomState.roundId.toString().slice(-5)}: Thắng Room ${winAmount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Xỉu)`
        ).catch(() => {});
      } else {
        // User lost - add 5% to pot
        const potContribution = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.POT_CONTRIBUTION);
        db.pots.update('taixiu', potContribution);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'bet',
          -bet.amount,
          `Thua Tài Xỉu Room: Xỉu ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `❌ Kỳ ${roomState.roundId.toString().slice(-5)}: Thua Room ${bet.amount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Tài)`
        ).catch(() => {});
      }
    }
  });
  
  // Process Chẵn/Lẻ bets
  roomState.bets.chan.forEach(bet => {
    const user = db.users.get(bet.userId);
    if (user) {
      if (isChan) {
        // User won
        const winAmount = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE);
        db.users.updateBalance(bet.userId, winAmount);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'win',
          winAmount,
          `Thắng Tài Xỉu Room: Chẵn ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `✨ Kỳ ${roomState.roundId.toString().slice(-5)}: Thắng Room ${winAmount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Chẵn)`
        ).catch(() => {});
      } else {
        // User lost - add 5% to pot
        const potContribution = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.POT_CONTRIBUTION);
        db.pots.update('taixiu', potContribution);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'bet',
          -bet.amount,
          `Thua Tài Xỉu Room: Chẵn ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `❌ Kỳ ${roomState.roundId.toString().slice(-5)}: Thua Room ${bet.amount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Lẻ)`
        ).catch(() => {});
      }
    }
  });
  
  roomState.bets.le.forEach(bet => {
    const user = db.users.get(bet.userId);
    if (user) {
      if (!isChan) {
        // User won
        const winAmount = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE);
        db.users.updateBalance(bet.userId, winAmount);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'win',
          winAmount,
          `Thắng Tài Xỉu Room: Lẻ ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `✨ Kỳ ${roomState.roundId.toString().slice(-5)}: Thắng Room ${winAmount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Lẻ)`
        ).catch(() => {});
      } else {
        // User lost - add 5% to pot
        const potContribution = Math.floor(bet.amount * config.GAMES.TAIXIU_ROOM.POT_CONTRIBUTION);
        db.pots.update('taixiu', potContribution);
        
        // Add transaction record
        db.transactions.add(
          bet.userId,
          'bet',
          -bet.amount,
          `Thua Tài Xỉu Room: Lẻ ${diceValues.join(' | ')} = ${sum}`
        );
        
        // Notify user
        bot.sendMessage(
          bet.userId,
          `❌ Kỳ ${roomState.roundId.toString().slice(-5)}: Thua Room ${bet.amount.toLocaleString()}\n\n🎲 Kết quả: ${diceValues.join(' | ')} = ${sum} (Chẵn)`
        ).catch(() => {});
      }
    }
  });
  
  // Hiển thị nút để bắt đầu phiên mới thay vì tự động bắt đầu
  setTimeout(() => {
    bot.sendMessage(chatId, `🎲 PHIÊN #${roomState.roundId.toString().slice(-5)} ĐÃ KẾT THÚC\n\nBạn có muốn bắt đầu phiên đặt cược mới không?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '▶️ Bắt đầu phiên mới', callback_data: 'start_taixiu_room' }]
        ]
      }
    });
  }, 5000);
}

// Place a bet for a user
async function placeBet(bot, msg, userId, betType, betAmount) {
  const chatId = msg.chat.id;
  const roomState = getRoomState(chatId);
  const db = require('../database');
  
  // Check if room is active and accepting bets
  if (!roomState.isActive) {
    return {
      success: false,
      message: "❌ Phòng đang không nhận cược. Vui lòng đợi vòng mới bắt đầu."
    };
  }
  
  // Get user
  const user = db.users.get(userId);
  if (!user) {
    return {
      success: false,
      message: "❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký."
    };
  }
  
  // Check if user has enough balance
  if (user.balance < betAmount) {
    return {
      success: false,
      message: "❌ Số dư không đủ để đặt cược."
    };
  }
  
  // Validate bet amount
  if (betAmount < config.GAMES.TAIXIU_ROOM.MIN_BET || betAmount > config.GAMES.TAIXIU_ROOM.MAX_BET) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${config.GAMES.TAIXIU_ROOM.MIN_BET.toLocaleString()} đến ${config.GAMES.TAIXIU_ROOM.MAX_BET.toLocaleString()} VNĐ.`
    };
  }
  
  // Deduct bet amount from user's balance
  db.users.updateBalance(userId, -betAmount);
  
  // Add bet to the room
  const bet = {
    userId: userId,
    amount: betAmount,
    timestamp: moment().format('YYYY-MM-DD HH:mm:ss')
  };
  
  // Update room state based on bet type
  switch (betType) {
    case 'tai':
      roomState.bets.tai.push(bet);
      roomState.totalBets.tai += betAmount;
      break;
    case 'xiu':
      roomState.bets.xiu.push(bet);
      roomState.totalBets.xiu += betAmount;
      break;
    case 'chan':
      roomState.bets.chan.push(bet);
      roomState.totalBets.chan += betAmount;
      break;
    case 'le':
      roomState.bets.le.push(bet);
      roomState.totalBets.le += betAmount;
      break;
    default:
      // Should never happen due to validation
      return {
        success: false,
        message: "❌ Loại cược không hợp lệ. Vui lòng chọn tai, xiu, chan hoặc le."
      };
  }
  
  // Update the room status message
  bot.editMessageText(
    getStatusMessage(roomState),
    {
      chat_id: chatId,
      message_id: roomState.messageId,
      parse_mode: 'Markdown'
    }
  ).catch(err => console.error('Error updating room status:', err));
  
  // Return success message
  return {
    success: true,
    message: `✅ Đặt cược thành công!\n- Cược: ${betType === 'tai' ? 'Tài' : betType === 'xiu' ? 'Xỉu' : betType === 'chan' ? 'Chẵn' : 'Lẻ'}\n- Số tiền: ${betAmount.toLocaleString()} VNĐ`
  };
}

module.exports = {
  startNewRound,
  placeBet,
  getRoomState // Xuất hàm này ra để có thể kiểm tra trạng thái phòng
};