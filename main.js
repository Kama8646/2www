const TelegramBot = require('node-telegram-bot-api');
const { Random } = require('random-js');
const moment = require('moment');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
require('dotenv').config();

// Import game functions
const { playTaiXiu } = require('./games/taixiu');
const { playChanLe } = require('./games/chanle');
const { playDoanSo } = require('./games/doanso');
const { playSlotMachine } = require('./games/slotmachine');
const taixiuRoom = require('./games/taixiu-room');

// Import config and validators
const config = require('./config');
const validators = require('./utils/validators');

// Create random number generator 
const random = new Random();

// Utility Functions - Formatters
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

// Format game result for Tài Xỉu
const formatTaiXiuResult = (dice, result) => {
  return `🎲${dice[0]} 🎲${dice[1]} 🎲${dice[2]} | ${result === 'tai' ? 'Tài ⚪️' : 'Xỉu ⚫️'}`;
};

// Format game result for Chẵn Lẻ
const formatChanLeResult = (number, result) => {
  return `🎲${number} | ${result === 'chan' ? 'Chẵn 🔴' : 'Lẻ 🔵'}`;
};

// Format game result for Đoán Số
const formatDoanSoResult = (number, userGuess) => {
  return `🎲${number} | Bạn đoán: 🎲${userGuess}`;
};

// Format game result for Slot Machine
const formatSlotResult = (symbols) => {
  return symbols.join(' | ');
};

// Create boxed message for game results
const createGameResultBox = (user, game, bet, betAmount, result, winAmount, timestamp) => {
  return `┏━━━━━━━━━━━ 📊 KẾT QUẢ 📊 ━━━━━━━━━━━┓
┣➤ 👤 NGƯỜI CHƠI: ${user.first_name} ${user.username ? '@' + user.username : ''}
┣➤ 🎮 GAME: ${game}
┣➤ 🎯 CƯỢC: ${bet}
┣➤ 💰 TIỀN CƯỢC: ${formatCurrency(betAmount)}
┣➤ 🎲 KẾT QUẢ: ${result}
┣➤ ${winAmount > 0 ? '💵 TIỀN THẮNG: ' + formatCurrency(winAmount) + ' 🥳' : '❌ THUA: -' + formatCurrency(betAmount) + ' 😢'}
┣➤ 🕒 THỜI GIAN: ${timestamp}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;
};

// Utility Functions - Validators
// Check if user is admin
const isAdmin = (userId) => {
  return config.ADMIN_IDS.includes(userId.toString());
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

// Database setup
// Initialize database
const adapter = new FileSync(config.DB_FILE);
const db = low(adapter);

// Set defaults if database is empty
db.defaults({
  users: [],
  transactions: [],
  games: [],
  pots: {
    taixiu: 100000,
    chanle: 100000,
    doanso: 100000,
    slotmachine: 100000,
  },
  giftcodes: [],
}).write();

const Database = {
  // User functions
  users: {
    // Check if a user exists
    exists: (userId) => {
      return db.get('users').find({ id: userId }).value() !== undefined;
    },
    
    // Get user by ID
    get: (userId) => {
      return db.get('users').find({ id: userId }).value();
    },
    
    // Create a new user
    create: (user) => {
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      const newUser = {
        id: user.id,
        username: user.username || 'Unknown',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        balance: config.INITIAL_BALANCE,
        totalBet: 0,
        registered: now,
        lastCheckin: null,
        banned: false,
      };
      
      db.get('users').push(newUser).write();
      return newUser;
    },
    
    // Update user's balance
    updateBalance: (userId, amount) => {
      const user = db.get('users').find({ id: userId });
      
      if (!user.value()) return false;
      
      user.update('balance', bal => bal + amount).write();
      
      if (amount > 0) {
        // Only update total bet if it's a bet (negative amount)
        return true;
      }
      
      user.update('totalBet', total => total + Math.abs(amount)).write();
      return true;
    },
    
    // Update user's last check-in time
    updateCheckin: (userId) => {
      const now = moment().format('YYYY-MM-DD');
      
      db.get('users')
        .find({ id: userId })
        .assign({ lastCheckin: now })
        .write();
      
      return true;
    },
    
    // Ban a user
    banUser: (userId, status = true) => {
      db.get('users')
        .find({ id: userId })
        .assign({ banned: status })
        .write();
      
      return true;
    },
    
    // Delete user account
    delete: (userId) => {
      db.get('users')
        .remove({ id: userId })
        .write();
      
      return true;
    },
    
    // Get top users by balance
    getTop: (limit = 10) => {
      return db.get('users')
        .filter(user => !user.banned)
        .orderBy(['balance'], ['desc'])
        .take(limit)
        .value();
    },
  },
  
  // Transaction functions
  transactions: {
    // Add a new transaction
    add: (userId, type, amount, description) => {
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      const transaction = {
        id: Date.now().toString(),
        userId,
        type,
        amount,
        description,
        timestamp: now,
      };
      
      db.get('transactions').push(transaction).write();
      return transaction;
    },
    
    // Get user's transactions
    getUserTransactions: (userId, limit = 5) => {
      return db.get('transactions')
        .filter({ userId })
        .orderBy(['timestamp'], ['desc'])
        .take(limit)
        .value();
    },
  },
  
  // Game history
  games: {
    // Add a new game result
    addResult: (gameType, userId, bet, betAmount, result, winAmount) => {
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      const game = {
        id: Date.now().toString(),
        gameType,
        userId,
        bet,
        betAmount,
        result,
        winAmount,
        timestamp: now,
      };
      
      db.get('games').push(game).write();
      return game;
    },
    
    // Get user's game history
    getUserGames: (userId, limit = 5) => {
      return db.get('games')
        .filter({ userId })
        .orderBy(['timestamp'], ['desc'])
        .take(limit)
        .value();
    },
  },
  
  // Pot management
  pots: {
    // Get pot amount
    get: (potName) => {
      return db.get('pots').get(potName).value() || 0;
    },
    
    // Update pot amount
    update: (potName, amount) => {
      const current = db.get('pots').get(potName).value() || 0;
      db.get('pots').set(potName, current + amount).write();
      return current + amount;
    },
  },
  
  // Giftcode management
  giftcodes: {
    // Create a new giftcode
    create: (code, amount, maxUses) => {
      const giftcode = {
        code,
        amount,
        maxUses,
        usedBy: [],
        created: moment().format('YYYY-MM-DD HH:mm:ss'),
      };
      
      db.get('giftcodes').push(giftcode).write();
      return giftcode;
    },
    
    // Use a giftcode
    use: (code, userId) => {
      const giftcode = db.get('giftcodes').find({ code });
      
      if (!giftcode.value()) return null;
      
      const gc = giftcode.value();
      
      // Check if user already used this code
      if (gc.usedBy.includes(userId)) return false;
      
      // Check if max uses reached
      if (gc.maxUses > 0 && gc.usedBy.length >= gc.maxUses) return false;
      
      // Update giftcode
      giftcode.update('usedBy', users => [...users, userId]).write();
      
      return gc.amount;
    },
    
    // Get all giftcodes
    getAll: () => {
      return db.get('giftcodes').value();
    },
  },
};

/* Game functions moved to separate files and imported at the top
// Keeping local implementation for reference only */
const playTaiXiuLocal = async (user, bet, amount) => {
  // Validate bet
  bet = bet.toLowerCase();
  if (!isValidTaiXiuBet(bet)) {
    return {
      success: false,
      message: '❌ Cược không hợp lệ. Vui lòng chọn "tai" hoặc "xiu".'
    };
  }
  
  // Validate bet amount
  if (!isValidBetAmount(amount, 'TAIXIU')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatCurrency(config.GAMES.TAIXIU.MIN_BET)} đến ${formatCurrency(config.GAMES.TAIXIU.MAX_BET)}.`
    };
  }
  
  // Check if user has enough balance
  if (!hasEnoughBalance(user, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để đặt cược.'
    };
  }
  
  // Deduct bet amount from user's balance
  Database.users.updateBalance(user.id, -amount);
  
  // Add to pot
  Database.pots.update('taixiu', amount * 0.05); // 5% goes to pot
  
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
    Database.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatTaiXiuResult(dice, result);
  const timestamp = formatTimestamp(new Date());
  
  // Save game result
  Database.games.addResult('taixiu', user.id, bet, amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    Database.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Tài Xỉu: ${formattedResult}`
    );
  } else {
    Database.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Tài Xỉu: ${bet}`
    );
  }
  
  // Create result message
  const resultBox = createGameResultBox(
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

// Chẵn Lẻ game
const playChanLeLocal = async (user, bet, amount) => {
  // Validate bet
  bet = bet.toLowerCase();
  if (!isValidChanLeBet(bet)) {
    return {
      success: false,
      message: '❌ Cược không hợp lệ. Vui lòng chọn "chan" hoặc "le".'
    };
  }
  
  // Validate bet amount
  if (!isValidBetAmount(amount, 'CHANLE')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatCurrency(config.GAMES.CHANLE.MIN_BET)} đến ${formatCurrency(config.GAMES.CHANLE.MAX_BET)}.`
    };
  }
  
  // Check if user has enough balance
  if (!hasEnoughBalance(user, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để đặt cược.'
    };
  }
  
  // Deduct bet amount from user's balance
  Database.users.updateBalance(user.id, -amount);
  
  // Add to pot
  Database.pots.update('chanle', amount * 0.05); // 5% goes to pot
  
  // Generate random number
  const number = random.integer(1, 100);
  
  // Determine result
  const result = number % 2 === 0 ? 'chan' : 'le';
  
  // Calculate win amount
  let winAmount = 0;
  if (bet === result) {
    winAmount = Math.floor(amount * config.GAMES.CHANLE.MULTIPLIER);
    Database.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatChanLeResult(number, result);
  const timestamp = formatTimestamp(new Date());
  
  // Save game result
  Database.games.addResult('chanle', user.id, bet, amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    Database.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Chẵn Lẻ: ${formattedResult}`
    );
  } else {
    Database.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Chẵn Lẻ: ${bet}`
    );
  }
  
  // Create result message
  const resultBox = createGameResultBox(
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

// Đoán Số game
const playDoanSoLocal = async (user, guess, amount) => {
  // Validate guess
  const numberGuess = parseInt(guess);
  if (isNaN(numberGuess) || numberGuess < 1 || numberGuess > 10) {
    return {
      success: false,
      message: '❌ Số đoán không hợp lệ. Vui lòng chọn số từ 1 đến 10.'
    };
  }
  
  // Validate bet amount
  if (!isValidBetAmount(amount, 'DOANSO')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatCurrency(config.GAMES.DOANSO.MIN_BET)} đến ${formatCurrency(config.GAMES.DOANSO.MAX_BET)}.`
    };
  }
  
  // Check if user has enough balance
  if (!hasEnoughBalance(user, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để đặt cược.'
    };
  }
  
  // Deduct bet amount from user's balance
  Database.users.updateBalance(user.id, -amount);
  
  // Add to pot
  Database.pots.update('doanso', amount * 0.05); // 5% goes to pot
  
  // Generate random number
  const number = random.integer(1, 10);
  
  // Calculate win amount
  let winAmount = 0;
  if (numberGuess === number) {
    winAmount = Math.floor(amount * config.GAMES.DOANSO.MULTIPLIER);
    Database.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatDoanSoResult(number, numberGuess);
  const timestamp = formatTimestamp(new Date());
  
  // Save game result
  Database.games.addResult('doanso', user.id, numberGuess.toString(), amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    Database.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Đoán Số: ${formattedResult}`
    );
  } else {
    Database.transactions.add(
      user.id, 
      'bet',
      -amount,
      `Đặt cược Đoán Số: ${numberGuess}`
    );
  }
  
  // Create result message
  const resultBox = createGameResultBox(
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

// Slot Machine symbols
const symbols = ['🍎', '🍊', '🍋', '🍒', '🍇', '💎', '7️⃣'];

// Slot Machine game
const playSlotMachineLocal = async (user, amount) => {
  // Validate bet amount
  if (!isValidBetAmount(amount, 'SLOTMACHINE')) {
    return {
      success: false,
      message: `❌ Số tiền cược phải từ ${formatCurrency(config.GAMES.SLOTMACHINE.MIN_BET)} đến ${formatCurrency(config.GAMES.SLOTMACHINE.MAX_BET)}.`
    };
  }
  
  // Check if user has enough balance
  if (!hasEnoughBalance(user, amount)) {
    return {
      success: false,
      message: '❌ Số dư không đủ để đặt cược.'
    };
  }
  
  // Deduct bet amount from user's balance
  Database.users.updateBalance(user.id, -amount);
  
  // Add to pot
  Database.pots.update('slotmachine', amount * 0.05); // 5% goes to pot
  
  // Generate random symbols
  const result = [
    symbols[random.integer(0, symbols.length - 1)],
    symbols[random.integer(0, symbols.length - 1)],
    symbols[random.integer(0, symbols.length - 1)]
  ];
  
  // Check for winning combinations
  const isAllSame = result[0] === result[1] && result[1] === result[2];
  const isTwoSame = result[0] === result[1] || result[1] === result[2] || result[0] === result[2];
  const isJackpot = isAllSame && result[0] === '7️⃣';
  
  // Calculate win amount
  let winAmount = 0;
  if (isJackpot) {
    winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.JACKPOT);
  } else if (isAllSame) {
    winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.THREE_SAME);
  } else if (isTwoSame) {
    winAmount = Math.floor(amount * config.GAMES.SLOTMACHINE.MULTIPLIERS.TWO_SAME);
  }
  
  // Add winnings to user's balance if won
  if (winAmount > 0) {
    Database.users.updateBalance(user.id, winAmount);
  }
  
  // Format result
  const formattedResult = formatSlotResult(result);
  const timestamp = formatTimestamp(new Date());
  
  // Save game result
  Database.games.addResult('slotmachine', user.id, 'slot', amount, formattedResult, winAmount);
  
  // Create transaction record
  if (winAmount > 0) {
    Database.transactions.add(
      user.id, 
      'win',
      winAmount,
      `Thắng từ Slot Machine: ${formattedResult}`
    );
  } else {
    Database.transactions.add(
      user.id, 
      'bet',
      -amount,
      'Đặt cược Slot Machine'
    );
  }
  
  // Create result message
  const resultBox = createGameResultBox(
    user,
    'Slot Machine',
    'Slot',
    amount,
    formattedResult,
    winAmount,
    timestamp
  );
  
  return {
    success: true,
    message: resultBox,
    win: winAmount > 0,
    winAmount: winAmount
  };
};

// User commands
const userCommands = {
  // Register new user
  register: async (user) => {
    // Check if user is already registered
    if (Database.users.exists(user.id)) {
      return {
        success: false,
        message: '❌ Bạn đã có tài khoản rồi!'
      };
    }
    
    // Create user in database
    const newUser = Database.users.create(user);
    
    return {
      success: true,
      message: `✅ Đăng ký thành công! Bạn đã nhận được ${formatCurrency(config.INITIAL_BALANCE)} tiền thưởng ban đầu.`
    };
  },
  
  // Get user profile
  getProfile: async (userId) => {
    // Get user from database
    const user = Database.users.get(userId);
    
    // If user doesn't exist
    if (!user) {
      return {
        success: false,
        message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
      };
    }
    
    // Get user's game history
    const gameHistory = Database.games.getUserGames(userId);
    
    // Format game history
    const formattedHistory = gameHistory.map(game => {
      return `- ${game.gameType.toUpperCase()}: ${game.winAmount > 0 ? '✅ +' + formatCurrency(game.winAmount) : '❌ -' + formatCurrency(game.betAmount)}`;
    }).join('\n');
    
    // Create profile message
    const message = `👤 THÔNG TIN TÀI KHOẢN 👤

┣➤ ID: ${user.id}
┣➤ Tên: ${user.first_name}
┣➤ Tài khoản: ${user.username ? '@' + user.username : 'Không có'}
┣➤ Số dư: ${formatCurrency(user.balance)}
┣➤ Tổng cược: ${formatCurrency(user.totalBet)}
┣➤ Ngày đăng ký: ${user.registered}
${user.banned ? '┣➤ Trạng thái: 🔒 Đã bị khóa' : '┣➤ Trạng thái: ✅ Hoạt động'}

🎮 LỊCH SỬ CHƠI GẦN ĐÂY 🎮
${formattedHistory || 'Chưa có lịch sử chơi game.'}`;

    return {
      success: true,
      message: message
    };
  },
  
  // Get games list
  getGamesList: async () => {
    const message = `🎮 DANH SÁCH CÁC GAME 🎮

1️⃣ TÀI XỈU
- Lệnh: /taixiu [tai/xiu] [số tiền]
- Luật chơi: Bot sẽ tung 3 xúc xắc. Tổng điểm dưới 10 là Xỉu, từ 11 trở lên là Tài.
- Tỷ lệ thắng: 1.8 lần tiền cược

2️⃣ CHẴN LẺ
- Lệnh: /chanle [chan/le] [số tiền]
- Luật chơi: Bot sẽ tạo số ngẫu nhiên từ 1-100. Nếu số chia hết cho 2 là Chẵn, ngược lại là Lẻ.
- Tỷ lệ thắng: 1.9 lần tiền cược

3️⃣ ĐOÁN SỐ
- Lệnh: /doanso [số 1-10] [số tiền]
- Luật chơi: Đoán đúng số ngẫu nhiên từ 1-10.
- Tỷ lệ thắng: 7 lần tiền cược

4️⃣ SLOT MACHINE
- Lệnh: /S [số tiền]
- Luật chơi: Quay 3 biểu tượng ngẫu nhiên.
- Tỷ lệ thắng:
  + Hai biểu tượng giống nhau: 1.5 lần tiền cược
  + Ba biểu tượng giống nhau: 5 lần tiền cược
  + Jackpot (777): 10 lần tiền cược`;

    return {
      success: true,
      message: message
    };
  },
  
  // Get leaderboard
  getLeaderboard: async () => {
    // Get top users by balance
    const topUsers = Database.users.getTop();
    
    // Format leaderboard
    const formattedLeaderboard = topUsers.map((user, index) => {
      return `${index + 1}. ${user.first_name}${user.username ? ' (@' + user.username + ')' : ''} - ${formatCurrency(user.balance)}`;
    }).join('\n');
    
    const message = `🏆 BẢNG XẾP HẠNG ĐẠI GIA 🏆

${formattedLeaderboard || 'Chưa có dữ liệu.'}`;

    return {
      success: true,
      message: message
    };
  },
  
  // Get pot amount
  getPot: async () => {
    // Get pot amounts
    const taiXiuPot = Database.pots.get('taixiu');
    const chanLePot = Database.pots.get('chanle');
    const doanSoPot = Database.pots.get('doanso');
    const slotPot = Database.pots.get('slotmachine');
    
    const message = `💰 CÁC HŨ TIỀN THƯỞNG 💰

┣➤ Tài Xỉu: ${formatCurrency(taiXiuPot)}
┣➤ Chẵn Lẻ: ${formatCurrency(chanLePot)}
┣➤ Đoán Số: ${formatCurrency(doanSoPot)}
┣➤ Slot Machine: ${formatCurrency(slotPot)}
┣➤ TỔNG: ${formatCurrency(taiXiuPot + chanLePot + doanSoPot + slotPot)}`;

    return {
      success: true,
      message: message
    };
  },
  
  // Transfer money to another user
  transferMoney: async (senderId, targetUsername, amount) => {
    // Minimum transfer amount
    const MIN_TRANSFER = 10000;
    
    // Check if amount is valid
    if (amount < MIN_TRANSFER) {
      return {
        success: false,
        message: `❌ Số tiền chuyển tối thiểu là ${formatCurrency(MIN_TRANSFER)}.`
      };
    }
    
    // Get sender user
    const sender = Database.users.get(senderId);
    
    // If sender doesn't exist
    if (!sender) {
      return {
        success: false,
        message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
      };
    }
    
    // Check if sender has enough balance
    if (sender.balance < amount) {
      return {
        success: false,
        message: '❌ Số dư không đủ để chuyển khoản.'
      };
    }
    
    // Find target user by username
    const targetUsername_clean = targetUsername.replace('@', '');
    const target = db.get('users').find({ username: targetUsername_clean }).value();
    
    // If target doesn't exist
    if (!target) {
      return {
        success: false,
        message: '❌ Người dùng không tồn tại. Vui lòng kiểm tra lại username.'
      };
    }
    
    // Check if target is the same as sender
    if (target.id === sender.id) {
      return {
        success: false,
        message: '❌ Bạn không thể chuyển tiền cho chính mình.'
      };
    }
    
    // Deduct amount from sender
    Database.users.updateBalance(sender.id, -amount);
    
    // Add amount to target
    Database.users.updateBalance(target.id, amount);
    
    // Create transaction records
    Database.transactions.add(
      sender.id,
      'transfer_out',
      -amount,
      `Chuyển tiền cho ${target.username ? '@' + target.username : target.first_name}`
    );
    
    Database.transactions.add(
      target.id,
      'transfer_in',
      amount,
      `Nhận tiền từ ${sender.username ? '@' + sender.username : sender.first_name}`
    );
    
    return {
      success: true,
      message: `✅ Chuyển khoản thành công!\n- Người nhận: ${target.first_name}${target.username ? ' (@' + target.username + ')' : ''}\n- Số tiền: ${formatCurrency(amount)}`
    };
  },
  
  // View user's money
  viewUserMoney: async (viewerId, targetUsername) => {
    // Find target user by username
    const targetUsername_clean = targetUsername.replace('@', '');
    const target = db.get('users').find({ username: targetUsername_clean }).value();
    
    // If target doesn't exist
    if (!target) {
      return {
        success: false,
        message: '❌ Người dùng không tồn tại. Vui lòng kiểm tra lại username.'
      };
    }
    
    return {
      success: true,
      message: `💰 THÔNG TIN TÀI KHOẢN 💰\n\n- Người dùng: ${target.first_name}${target.username ? ' (@' + target.username + ')' : ''}\n- Số dư: ${formatCurrency(target.balance)}`
    };
  },
  
  // Delete user account
  deleteAccount: async (userId) => {
    // Get user from database
    const user = Database.users.get(userId);
    
    // If user doesn't exist
    if (!user) {
      return {
        success: false,
        message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
      };
    }
    
    // Delete user
    Database.users.delete(userId);
    
    return {
      success: true,
      message: '✅ Tài khoản của bạn đã được xóa thành công.'
    };
  },
  
  // Daily check-in
  dailyCheckin: async (userId) => {
    // Get user from database
    const user = Database.users.get(userId);
    
    // If user doesn't exist
    if (!user) {
      return {
        success: false,
        message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
      };
    }
    
    // Check if user can claim
    if (!canClaimDailyBonus(user)) {
      return {
        success: false,
        message: '❌ Bạn đã điểm danh hôm nay rồi. Vui lòng quay lại vào ngày mai.'
      };
    }
    
    // Update user's checkin time
    Database.users.updateCheckin(userId);
    
    // Add bonus to user's balance
    Database.users.updateBalance(userId, config.DAILY_BONUS);
    
    // Create transaction record
    Database.transactions.add(
      userId,
      'bonus',
      config.DAILY_BONUS,
      'Điểm danh hàng ngày'
    );
    
    return {
      success: true,
      message: `✅ Điểm danh thành công! Bạn đã nhận được ${formatCurrency(config.DAILY_BONUS)}.`
    };
  },
  
  // Use giftcode
  useGiftcode: async (userId, code) => {
    // Get user from database
    const user = Database.users.get(userId);
    
    // If user doesn't exist
    if (!user) {
      return {
        success: false,
        message: '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.'
      };
    }
    
    // Use giftcode
    const amount = Database.giftcodes.use(code, userId);
    
    // If giftcode doesn't exist
    if (amount === null) {
      return {
        success: false,
        message: '❌ Giftcode không tồn tại. Vui lòng kiểm tra lại.'
      };
    }
    
    // If user already used this giftcode or max uses reached
    if (amount === false) {
      return {
        success: false,
        message: '❌ Bạn đã sử dụng giftcode này rồi hoặc giftcode đã hết lượt sử dụng.'
      };
    }
    
    // Add amount to user's balance
    Database.users.updateBalance(userId, amount);
    
    // Create transaction record
    Database.transactions.add(
      userId,
      'giftcode',
      amount,
      `Sử dụng giftcode: ${code}`
    );
    
    return {
      success: true,
      message: `✅ Sử dụng giftcode thành công! Bạn đã nhận được ${formatCurrency(amount)}.`
    };
  },
};

// Admin commands
const adminCommands = {
  // Add money to user
  addMoney: async (adminId, targetId, amount) => {
    // Check if user is admin
    if (!isAdmin(adminId)) {
      return {
        success: false,
        message: '❌ Bạn không có quyền thực hiện hành động này.'
      };
    }
    
    // Find target user by ID
    const target = Database.users.get(targetId);
    
    // If target doesn't exist
    if (!target) {
      return {
        success: false,
        message: '❌ Người dùng không tồn tại. Vui lòng kiểm tra lại ID.'
      };
    }
    
    // Add amount to target's balance
    Database.users.updateBalance(targetId, amount);
    
    // Create transaction record
    Database.transactions.add(
      targetId,
      'admin_add',
      amount,
      'Admin thêm tiền'
    );
    
    return {
      success: true,
      message: `✅ Đã thêm ${formatCurrency(amount)} vào tài khoản của ${target.first_name}${target.username ? ' (@' + target.username + ')' : ''}.`
    };
  },
  
  // Ban user
  banUser: async (adminId, targetId, reason) => {
    // Check if user is admin
    if (!isAdmin(adminId)) {
      return {
        success: false,
        message: '❌ Bạn không có quyền thực hiện hành động này.'
      };
    }
    
    // Find target user by ID
    const target = Database.users.get(targetId);
    
    // If target doesn't exist
    if (!target) {
      return {
        success: false,
        message: '❌ Người dùng không tồn tại. Vui lòng kiểm tra lại ID.'
      };
    }
    
    // Ban user
    Database.users.banUser(targetId, true);
    
    return {
      success: true,
      message: `✅ Đã cấm người dùng ${target.first_name}${target.username ? ' (@' + target.username + ')' : ''} vì lý do: ${reason}.`
    };
  },
  
  // Unban user
  unbanUser: async (adminId, targetId) => {
    // Check if user is admin
    if (!isAdmin(adminId)) {
      return {
        success: false,
        message: '❌ Bạn không có quyền thực hiện hành động này.'
      };
    }
    
    // Find target user by ID
    const target = Database.users.get(targetId);
    
    // If target doesn't exist
    if (!target) {
      return {
        success: false,
        message: '❌ Người dùng không tồn tại. Vui lòng kiểm tra lại ID.'
      };
    }
    
    // Unban user
    Database.users.banUser(targetId, false);
    
    return {
      success: true,
      message: `✅ Đã bỏ cấm người dùng ${target.first_name}${target.username ? ' (@' + target.username + ')' : ''}.`
    };
  },
  
  // Create giftcode
  createGiftcode: async (adminId, code, amount, maxUses) => {
    // Check if user is admin
    if (!isAdmin(adminId)) {
      return {
        success: false,
        message: '❌ Bạn không có quyền thực hiện hành động này.'
      };
    }
    
    // Create giftcode
    const giftcode = Database.giftcodes.create(code, amount, maxUses);
    
    return {
      success: true,
      message: `✅ Đã tạo giftcode thành công!\n- Mã: ${giftcode.code}\n- Số tiền: ${formatCurrency(giftcode.amount)}\n- Lượt sử dụng: ${giftcode.maxUses > 0 ? giftcode.maxUses : 'Không giới hạn'}`
    };
  },
  
  // Get statistics
  getStats: async (adminId) => {
    // Check if user is admin
    if (!isAdmin(adminId)) {
      return {
        success: false,
        message: '❌ Bạn không có quyền thực hiện hành động này.'
      };
    }
    
    // Get all users
    const users = db.get('users').value();
    const totalUsers = users.length;
    const bannedUsers = users.filter(user => user.banned).length;
    
    // Get total balance
    const totalBalance = users.reduce((sum, user) => sum + user.balance, 0);
    
    // Get total bets
    const totalBets = users.reduce((sum, user) => sum + user.totalBet, 0);
    
    // Get pot amounts
    const taiXiuPot = Database.pots.get('taixiu');
    const chanLePot = Database.pots.get('chanle');
    const doanSoPot = Database.pots.get('doanso');
    const slotPot = Database.pots.get('slotmachine');
    const totalPot = taiXiuPot + chanLePot + doanSoPot + slotPot;
    
    // Get giftcodes
    const giftcodes = Database.giftcodes.getAll();
    const totalGiftcodes = giftcodes.length;
    
    const message = `📊 THỐNG KÊ HỆ THỐNG 📊

👥 NGƯỜI DÙNG
┣➤ Tổng số người dùng: ${totalUsers}
┣➤ Số người dùng bị cấm: ${bannedUsers}
┣➤ Tổng số dư của người dùng: ${formatCurrency(totalBalance)}
┣➤ Tổng số tiền đã cược: ${formatCurrency(totalBets)}

💰 HŨ THƯỞNG
┣➤ Tài Xỉu: ${formatCurrency(taiXiuPot)}
┣➤ Chẵn Lẻ: ${formatCurrency(chanLePot)}
┣➤ Đoán Số: ${formatCurrency(doanSoPot)}
┣➤ Slot Machine: ${formatCurrency(slotPot)}
┣➤ TỔNG: ${formatCurrency(totalPot)}

🎁 GIFTCODE
┣➤ Tổng số giftcode: ${totalGiftcodes}`;

    return {
      success: true,
      message: message
    };
  },
};

// Create Telegram bot
const bot = new TelegramBot(config.TOKEN, { polling: true });

// Middleware kiểm tra ID chat
bot.on('message', (msg) => {
  // Không áp dụng cho các lệnh như /chatid, /settings, /settoken, /setadmins, /setchats
  if (msg.text && (
    msg.text.startsWith('/chatid') || 
    msg.text.startsWith('/settings') || 
    msg.text.startsWith('/settoken') || 
    msg.text.startsWith('/setadmins') || 
    msg.text.startsWith('/setchats')
  )) {
    return; // Cho phép các lệnh này hoạt động
  }
  
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Kiểm tra nếu người dùng là admin thì luôn cho phép
  if (validators.isAdmin(userId)) {
    return; // Cho phép admin sử dụng bot trong mọi chat
  }
  
  // Nếu chat ID list không rỗng, kiểm tra xem chat hiện tại có được phép không
  if (config.ALLOWED_CHAT_IDS.length > 0 && !validators.isChatAllowed(chatId)) {
    // Bỏ qua tin nhắn trong chat không được phép
    return;
  }
});

// Log startup
console.log('Bot is starting...');

// Create command handlers
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isUserAdmin = isAdmin(userId);
  
  // Gửi 3 emoji xúc xắc riêng biệt
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  
  let message = `🎮 Chào mừng bạn đến với Bot Tài Xỉu! 🎮

Dưới đây là các lệnh có sẵn:

/register - Đăng Kí Tài Khoản
/profile - Xem Thông Tin Tài Khoản
/game - Danh Sách Các Game
/taixiu - Game Tài xỉu
/chanle - Game Chẵn Lẻ
/doanso - Game Đoán Số
/S - Game Slot Machine
/taixiuroom - Tạo Phòng Cược Tài Xỉu (trong nhóm)
/bxh - Bảng Xếp Hạng Đại Gia
/pot - Xem Tiền Trong Hũ
/giftcode - Nhập Giftcode
/chuyentien - Chuyển Tiền Cho Người Khác
/money - Xem Tiền Người Khác
/deleteaccount - Xoá Tài Khoản
/diemdanh - Điểm Danh Hàng Ngày`;

  // Nếu là admin, hiển thị thêm lệnh admin
  if (isUserAdmin) {
    message += `

👑 LỆNH DÀNH CHO ADMIN 👑
/addmoney - Thêm Tiền Cho Người Dùng
/ban - Cấm Người Dùng
/unban - Bỏ Cấm Người Dùng
/creategiftcode - Tạo Giftcode
/stats - Xem Thống Kê Hệ Thống`;
  }

  message += `

Hãy bắt đầu bằng cách đăng ký tài khoản với lệnh /register hoặc sử dụng các nút bấm bên dưới.`;

  bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Đăng ký', callback_data: 'register_account' },
          { text: '💰 Xem số dư', callback_data: 'check_balance' }
        ],
        [
          { text: '🎮 Danh sách trò chơi', callback_data: 'show_games' },
          { text: '🎁 Điểm danh', callback_data: 'daily_checkin' }
        ]
      ]
    }
  });
});

// Register command
bot.onText(/\/register/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const result = await userCommands.register(msg.from);
  bot.sendMessage(chatId, result.message);
});

// Profile command
bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const result = await userCommands.getProfile(userId);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Xem số dư', callback_data: 'check_balance' },
          { text: '🎮 Trò chơi', callback_data: 'show_games' }
        ],
        [
          { text: '🎁 Điểm danh', callback_data: 'daily_checkin' },
          { text: '📊 Bảng xếp hạng', callback_data: 'show_leaderboard' }
        ]
      ]
    }
  });
});

// Games list command
bot.onText(/\/game/, async (msg) => {
  const chatId = msg.chat.id;
  
  const result = await userCommands.getGamesList();
  
  // Hiển thị danh sách trò chơi với các nút bấm nhanh
  const gamesKeyboard = [
    [{ text: '🎲 Tài Xỉu', callback_data: 'game_taixiu' },
     { text: '🎮 Chẵn Lẻ', callback_data: 'game_chanle' }],
    [{ text: '🔢 Đoán Số', callback_data: 'game_doanso' },
     { text: '🎰 Slot Machine', callback_data: 'game_slot' }],
    [{ text: '🎲 Phòng Tài Xỉu', callback_data: 'game_taixiuroom' }],
    [{ text: '💰 Xem số dư', callback_data: 'check_balance' },
     { text: '🎁 Điểm danh', callback_data: 'daily_checkin' }]
  ];
  
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: gamesKeyboard
    }
  });
});

// Tài Xỉu game command
bot.onText(/\/taixiu(?:\s+(\S+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Gửi 3 emoji xúc xắc riêng biệt
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  
  // Get user
  const user = Database.users.get(userId);
  if (!user) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  if (user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  const bet = match[1]?.toLowerCase();
  const amount = match[2] ? parseInt(match[2]) : null;
  
  if (!bet || !amount) {
    const betAmountOptions = [10000, 20000, 50000, 100000];
    const betOptions = [
      [{ text: '🎲 Tài 10K', callback_data: 'bet_taixiu_tai_10000' }, { text: '🎲 Xỉu 10K', callback_data: 'bet_taixiu_xiu_10000' }],
      [{ text: '🎲 Tài 20K', callback_data: 'bet_taixiu_tai_20000' }, { text: '🎲 Xỉu 20K', callback_data: 'bet_taixiu_xiu_20000' }],
      [{ text: '🎲 Tài 50K', callback_data: 'bet_taixiu_tai_50000' }, { text: '🎲 Xỉu 50K', callback_data: 'bet_taixiu_xiu_50000' }],
      [{ text: '🎲 Tài 100K', callback_data: 'bet_taixiu_tai_100000' }, { text: '🎲 Xỉu 100K', callback_data: 'bet_taixiu_xiu_100000' }],
      [{ text: '💰 Xem số dư', callback_data: 'check_balance' }]
    ];
    
    return bot.sendMessage(chatId, `🎲 GAME TÀI XỈU 🎲

Luật chơi:
- Bot sẽ tung 3 xúc xắc
- Tổng điểm dưới 10 là Xỉu ⚫️
- Tổng điểm từ 11 trở lên là Tài ⚪️
- Tỷ lệ thắng: 1.8 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  }
  
  // Play the game
  const result = await playTaiXiu(user, bet, amount);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎲 Chơi lại Tài', callback_data: `bet_taixiu_tai_${amount}` },
         { text: '🎲 Chơi lại Xỉu', callback_data: `bet_taixiu_xiu_${amount}` }],
        [{ text: '💰 Xem số dư', callback_data: 'check_balance' },
         { text: '🎮 Trò chơi khác', callback_data: 'show_games' }]
      ]
    }
  });
});

// Chẵn Lẻ game command
bot.onText(/\/chanle(?:\s+(\S+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Gửi 3 emoji xúc xắc riêng biệt
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  
  // Get user
  const user = Database.users.get(userId);
  if (!user) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  if (user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  const bet = match[1]?.toLowerCase();
  const amount = match[2] ? parseInt(match[2]) : null;
  
  if (!bet || !amount) {
    const betOptions = [
      [{ text: '🔴 Chẵn 10K', callback_data: 'bet_chanle_chan_10000' }, { text: '🔵 Lẻ 10K', callback_data: 'bet_chanle_le_10000' }],
      [{ text: '🔴 Chẵn 20K', callback_data: 'bet_chanle_chan_20000' }, { text: '🔵 Lẻ 20K', callback_data: 'bet_chanle_le_20000' }],
      [{ text: '🔴 Chẵn 50K', callback_data: 'bet_chanle_chan_50000' }, { text: '🔵 Lẻ 50K', callback_data: 'bet_chanle_le_50000' }],
      [{ text: '🔴 Chẵn 100K', callback_data: 'bet_chanle_chan_100000' }, { text: '🔵 Lẻ 100K', callback_data: 'bet_chanle_le_100000' }],
      [{ text: '💰 Xem số dư', callback_data: 'check_balance' }, { text: '🎮 Trò chơi khác', callback_data: 'show_games' }]
    ];
    
    return bot.sendMessage(chatId, `🎮 GAME CHẴN LẺ 🎮

Luật chơi:
- Bot sẽ tạo một số ngẫu nhiên từ 1-100
- Nếu số chẵn (chia hết cho 2) và bạn đặt "chan", bạn thắng
- Nếu số lẻ (không chia hết cho 2) và bạn đặt "le", bạn thắng
- Tỷ lệ thắng: 1.9 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  }
  
  // Play the game
  const result = await playChanLe(user, bet, amount);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔴 Chơi lại Chẵn', callback_data: `bet_chanle_chan_${amount}` },
         { text: '🔵 Chơi lại Lẻ', callback_data: `bet_chanle_le_${amount}` }],
        [{ text: '💰 Xem số dư', callback_data: 'check_balance' },
         { text: '🎮 Trò chơi khác', callback_data: 'show_games' }]
      ]
    }
  });
});

// Đoán Số game command
bot.onText(/\/doanso(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Gửi 3 emoji xúc xắc riêng biệt
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  
  // Get user
  const user = Database.users.get(userId);
  if (!user) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  if (user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  const guess = match[1];
  const amount = match[2] ? parseInt(match[2]) : null;
  
  if (!guess || !amount) {
    // Tạo buttons cho tất cả số từ 1-10
    const numberButtons = [];
    const betAmount = 50000; // Default bet amount
    
    // Tạo hàng thứ nhất: 1-5
    const row1 = [];
    for (let i = 1; i <= 5; i++) {
      row1.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    numberButtons.push(row1);
    
    // Tạo hàng thứ hai: 6-10
    const row2 = [];
    for (let i = 6; i <= 10; i++) {
      row2.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    numberButtons.push(row2);
    
    // Tạo các lựa chọn mức cược
    const row3 = [
      { text: '💵 10K', callback_data: 'doanso_amount_10000' },
      { text: '💵 20K', callback_data: 'doanso_amount_20000' },
      { text: '💵 50K', callback_data: 'doanso_amount_50000' },
      { text: '💵 100K', callback_data: 'doanso_amount_100000' }
    ];
    numberButtons.push(row3);
    
    // Các tùy chọn khác
    const row4 = [
      { text: '🔙 Quay lại', callback_data: 'show_games' }, 
      { text: '💰 Xem số dư', callback_data: 'check_balance' }
    ];
    numberButtons.push(row4);
    
    return bot.sendMessage(chatId, `🔢 GAME ĐOÁN SỐ 🔢

Luật chơi:
- Chọn một số từ 1 đến 10
- Nếu đoán đúng, bạn thắng 7 lần tiền cược
- Tỷ lệ thắng: 1/10 (10%)`, {
      reply_markup: {
        inline_keyboard: numberButtons
      }
    });
  }
  
  // Play the game
  const result = await playDoanSo(user, guess, amount);
  
  // Tạo inline buttons cho kết quả
  const inlineButtons = [];
  
  // Tạo nút chơi lại
  const replayButtons = [];
  for (let i = 1; i <= 5; i++) {
    replayButtons.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${amount}` });
  }
  inlineButtons.push(replayButtons);
  
  const replayButtons2 = [];
  for (let i = 6; i <= 10; i++) {
    replayButtons2.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${amount}` });
  }
  inlineButtons.push(replayButtons2);
  
  // Nút điều hướng khác
  inlineButtons.push([
    { text: '💰 Xem số dư', callback_data: 'check_balance' },
    { text: '🎮 Trò chơi khác', callback_data: 'show_games' }
  ]);
  
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: inlineButtons
    }
  });
});

// Slot Machine game command
bot.onText(/\/S(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Gửi 3 emoji xúc xắc riêng biệt
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  await bot.sendMessage(chatId, '🎲');
  
  // Get user
  const user = Database.users.get(userId);
  if (!user) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  if (user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  const amount = match[1] ? parseInt(match[1]) : null;
  
  if (!amount) {
    // Tạo buttons các mức cược
    const betOptions = [
      [
        { text: '🎰 Quay 10K', callback_data: 'bet_slot_10000' },
        { text: '🎰 Quay 20K', callback_data: 'bet_slot_20000' }
      ],
      [
        { text: '🎰 Quay 50K', callback_data: 'bet_slot_50000' },
        { text: '🎰 Quay 100K', callback_data: 'bet_slot_100000' }
      ],
      [
        { text: '🔙 Quay lại', callback_data: 'show_games' },
        { text: '💰 Xem số dư', callback_data: 'check_balance' }
      ]
    ];
    
    return bot.sendMessage(chatId, `🎰 GAME SLOT MACHINE 🎰

Luật chơi:
- Bot sẽ quay 3 biểu tượng ngẫu nhiên 
- Hai ký tự giống nhau: 1.5 lần tiền cược
- Ba ký tự giống nhau: 5 lần tiền cược
- Jackpot (777): 10 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  }
  
  // Play the game
  const result = await playSlotMachine(user, amount);
  
  // Tạo nút bấm sau khi chơi
  const replayButtons = [
    [
      { text: '🎰 Quay lại cùng mức', callback_data: `bet_slot_${amount}` },
      { text: '💰 Xem số dư', callback_data: 'check_balance' }
    ],
    [
      { text: '🎮 Trò chơi khác', callback_data: 'show_games' },
      { text: '🔄 Đổi mức cược', callback_data: 'game_slot' }
    ]
  ];
  
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: replayButtons
    }
  });
});

// Leaderboard command
bot.onText(/\/bxh/, async (msg) => {
  const chatId = msg.chat.id;
  
  const result = await userCommands.getLeaderboard();
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎮 Trò chơi', callback_data: 'show_games' },
          { text: '💰 Xem số dư', callback_data: 'check_balance' }
        ]
      ]
    }
  });
});

// Pot command
bot.onText(/\/pot/, async (msg) => {
  const chatId = msg.chat.id;
  
  const result = await userCommands.getPot();
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎮 Trò chơi', callback_data: 'show_games' },
          { text: '💰 Xem số dư', callback_data: 'check_balance' }
        ]
      ]
    }
  });
});

// Transfer money command
bot.onText(/\/chuyentien(?:\s+(@\S+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const targetUsername = match[1];
  const amount = match[2] ? parseInt(match[2]) : null;
  
  if (!targetUsername || !amount) {
    const transferOptions = [
      [
        { text: '💸 10K', callback_data: 'transfer_amount_10000' },
        { text: '💸 20K', callback_data: 'transfer_amount_20000' }
      ],
      [
        { text: '💸 50K', callback_data: 'transfer_amount_50000' },
        { text: '💸 100K', callback_data: 'transfer_amount_100000' }
      ],
      [
        { text: '🔙 Quay lại', callback_data: 'show_games' },
        { text: '💰 Xem số dư', callback_data: 'check_balance' }
      ]
    ];
    
    return bot.sendMessage(chatId, `💸 CHUYỂN TIỀN 💸

Cách sử dụng:
/chuyentien [@username] [số tiền]

Ví dụ:
/chuyentien @friend 50000

Lưu ý:
- Số tiền tối thiểu: 10,000 VNĐ
- Không mất phí chuyển tiền

Bạn cần nhập đầy đủ lệnh với username người nhận và số tiền.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Xem số dư', callback_data: 'check_balance' }]
        ]
      }
    });
  }
  
  const result = await userCommands.transferMoney(userId, targetUsername, amount);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Xem số dư', callback_data: 'check_balance' },
          { text: '🎮 Trò chơi', callback_data: 'show_games' }
        ]
      ]
    }
  });
});

// View money command
bot.onText(/\/money(?:\s+(@\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const targetUsername = match[1];
  
  if (!targetUsername) {
    return bot.sendMessage(chatId, `💰 XEM TIỀN NGƯỜI KHÁC 💰

Cách sử dụng:
/money [@username]

Ví dụ:
/money @friend`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Xem số dư', callback_data: 'check_balance' },
            { text: '🎮 Trò chơi', callback_data: 'show_games' }
          ]
        ]
      }
    });
  }
  
  const result = await userCommands.viewUserMoney(userId, targetUsername);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Xem số dư', callback_data: 'check_balance' },
          { text: '🎮 Trò chơi', callback_data: 'show_games' }
        ]
      ]
    }
  });
});

// Delete account command
bot.onText(/\/deleteaccount/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Ask for confirmation
  const confirmationMsg = await bot.sendMessage(chatId, '⚠️ Bạn có chắc chắn muốn xóa tài khoản? Hành động này không thể hoàn tác.\n\nGửi "xác nhận" để tiếp tục, hoặc nhấn hủy.', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '❌ Hủy', callback_data: 'cancel_delete_account' }
        ]
      ],
      force_reply: true,
      selective: true
    }
  });
  
  // Listen for reply
  bot.onReplyToMessage(chatId, confirmationMsg.message_id, async (confirmMsg) => {
    if (confirmMsg.text && confirmMsg.text.toLowerCase() === 'xác nhận') {
      const result = await userCommands.deleteAccount(userId);
      bot.sendMessage(chatId, result.message);
    } else {
      bot.sendMessage(chatId, '❌ Đã hủy xóa tài khoản.');
    }
  });
});

// Daily check-in command
bot.onText(/\/diemdanh/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const result = await userCommands.dailyCheckin(userId);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Xem số dư', callback_data: 'check_balance' },
          { text: '🎮 Trò chơi', callback_data: 'show_games' }
        ]
      ]
    }
  });
});

// Lệnh lấy ID chat hiện tại (hoạt động trong mọi chat)
bot.onText(/\/chatid/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🆔 ID của chat này là: ${chatId}`);
});

// Lệnh hiển thị cài đặt - chỉ dành cho admin
bot.onText(/\/settings/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Kiểm tra quyền admin
  if (!validators.isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Chỉ admin mới có quyền truy cập cài đặt.');
  }
  
  const message = `⚙️ CÀI ĐẶT HỆ THỐNG ⚙️

1️⃣ Token Bot: ${config.TOKEN.slice(0, 5)}...${config.TOKEN.slice(-4)}
2️⃣ ID Admin: ${config.ADMIN_IDS.join(', ')}
3️⃣ Chat được phép: ${config.ALLOWED_CHAT_IDS.length > 0 ? config.ALLOWED_CHAT_IDS.join(', ') : 'Tất cả'}

Để thay đổi cài đặt, vui lòng chỉnh sửa trực tiếp trong file .env
Sử dụng lệnh /chatid để lấy ID của chat hiện tại.`;
  
  bot.sendMessage(chatId, message);
});

// Các lệnh cài đặt đã bị loại bỏ theo yêu cầu
// Người dùng có thể chỉnh sửa trực tiếp trong file .env

// Giftcode command
bot.onText(/\/giftcode(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const code = match[1];
  
  if (!code) {
    return bot.sendMessage(chatId, `🎁 NHẬP GIFTCODE 🎁

Cách sử dụng:
/giftcode [mã code]

Ví dụ:
/giftcode WELCOME2023`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Xem số dư', callback_data: 'check_balance' },
            { text: '🎮 Trò chơi', callback_data: 'show_games' }
          ]
        ]
      }
    });
  }
  
  const result = await userCommands.useGiftcode(userId, code);
  bot.sendMessage(chatId, result.message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Xem số dư', callback_data: 'check_balance' },
          { text: '🎮 Trò chơi', callback_data: 'show_games' }
        ]
      ]
    }
  });
});

// Admin commands

// Add money command
bot.onText(/\/addmoney(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(adminId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const targetId = match[1];
  const amount = match[2] ? parseInt(match[2]) : null;
  
  if (!targetId || !amount) {
    return bot.sendMessage(chatId, `👑 ADMIN: THÊM TIỀN 👑

Cách sử dụng:
/addmoney [ID người dùng] [số tiền]

Ví dụ:
/addmoney 123456789 50000`);
  }
  
  const result = await adminCommands.addMoney(adminId, targetId, amount);
  bot.sendMessage(chatId, result.message);
});

// Ban user command
bot.onText(/\/ban(?:\s+(\d+))?(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(adminId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const targetId = match[1];
  const reason = match[2] || 'Vi phạm điều khoản sử dụng';
  
  if (!targetId) {
    return bot.sendMessage(chatId, `👑 ADMIN: CẤM NGƯỜI DÙNG 👑

Cách sử dụng:
/ban [ID người dùng] [lý do]

Ví dụ:
/ban 123456789 Gian lận`);
  }
  
  const result = await adminCommands.banUser(adminId, targetId, reason);
  bot.sendMessage(chatId, result.message);
});

// Unban user command
bot.onText(/\/unban(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(adminId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const targetId = match[1];
  
  if (!targetId) {
    return bot.sendMessage(chatId, `👑 ADMIN: BỎ CẤM NGƯỜI DÙNG 👑

Cách sử dụng:
/unban [ID người dùng]

Ví dụ:
/unban 123456789`);
  }
  
  const result = await adminCommands.unbanUser(adminId, targetId);
  bot.sendMessage(chatId, result.message);
});

// Create giftcode command
bot.onText(/\/creategiftcode(?:\s+(\S+))?(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(adminId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const code = match[1];
  const amount = match[2] ? parseInt(match[2]) : null;
  const maxUses = match[3] ? parseInt(match[3]) : 0;
  
  if (!code || !amount) {
    return bot.sendMessage(chatId, `👑 ADMIN: TẠO GIFTCODE 👑

Cách sử dụng:
/creategiftcode [mã code] [số tiền] [số lượt sử dụng]

Ví dụ:
/creategiftcode WELCOME2023 50000 10

Lưu ý:
- Số lượt sử dụng = 0 nghĩa là không giới hạn`);
  }
  
  const result = await adminCommands.createGiftcode(adminId, code, amount, maxUses);
  bot.sendMessage(chatId, result.message);
});

// Get stats command
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const result = await adminCommands.getStats(userId);
  bot.sendMessage(chatId, result.message);
});

// Get settings command
bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const result = await adminCommands.getSettings(userId);
  bot.sendMessage(chatId, result.message);
});

// Set token command
bot.onText(/\/settoken (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const newToken = match[1].trim();
  const result = await adminCommands.updateToken(userId, newToken);
  
  // Xóa tin nhắn chứa token để bảo mật
  try {
    await bot.deleteMessage(chatId, msg.message_id);
  } catch (err) {
    console.log('Could not delete message containing token:', err);
  }
  
  bot.sendMessage(chatId, result.message);
});

// Set admin IDs command
bot.onText(/\/setadmins (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const newAdminIds = match[1].trim();
  const result = await adminCommands.updateAdminIds(userId, newAdminIds);
  bot.sendMessage(chatId, result.message);
});

// Set allowed chat IDs command
bot.onText(/\/setchats (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const newChatIds = match[1].trim();
  const result = await adminCommands.updateAllowedChatIds(userId, newChatIds);
  bot.sendMessage(chatId, result.message);
});

// Get current chat ID command
bot.onText(/\/chatid/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🆔 Chat ID: ${chatId}`);
});

// Handle inline buttons (callback queries)
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;
  
  // Acknowledge the callback query (except for specific cases that need custom responses)
  if (!data.includes('start_taixiu_room')) {
    bot.answerCallbackQuery(query.id);
  }
  
  // Handle Tài Xỉu Room start (moved from separate handler)
  if (data === 'start_taixiu_room') {
    // Check if message is from a group chat
    if (query.message.chat.type !== 'group' && query.message.chat.type !== 'supergroup') {
      return bot.answerCallbackQuery(query.id, '❌ Lệnh này chỉ có thể sử dụng trong các nhóm chat.', true);
    }
    
    // Check if user is registered
    if (!Database.users.exists(userId)) {
      return bot.answerCallbackQuery(query.id, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.', true);
    }
    
    // Check if user is banned
    const user = Database.users.get(userId);
    if (user && user.banned) {
      return bot.answerCallbackQuery(query.id, '❌ Tài khoản của bạn đã bị cấm.', true);
    }
    
    // Start a new Tài Xỉu room
    try {
      await taixiuRoom.startNewRound(bot, chatId);
      bot.answerCallbackQuery(query.id, '✅ Đã bắt đầu phiên đặt cược mới!');
    } catch (error) {
      console.error('Error starting Tài Xỉu room:', error);
      bot.answerCallbackQuery(query.id, '❌ Có lỗi xảy ra khi bắt đầu phiên mới.', true);
    }
    return;
  }
  
  // Handle other callback data
  if (data === 'register_account') {
    // Handle register account
    const result = await userCommands.register(query.from);
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Xem số dư', callback_data: 'check_balance' },
            { text: '🎮 Trò chơi', callback_data: 'show_games' }
          ]
        ]
      }
    });
  } else if (data === 'show_leaderboard') {
    // Handle show leaderboard
    const result = await userCommands.getLeaderboard();
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎮 Trò chơi', callback_data: 'show_games' },
            { text: '💰 Xem số dư', callback_data: 'check_balance' }
          ]
        ]
      }
    });
  } else if (data === 'game_taixiuroom') {
    // Handle Tài Xỉu Room game from callback query
    // Check if in a group chat
    if (query.message.chat.type !== 'group' && query.message.chat.type !== 'supergroup') {
      bot.answerCallbackQuery(query.id, { text: '❌ Tính năng này chỉ hoạt động trong nhóm chat.' });
      return bot.sendMessage(chatId, '❌ Tính năng Phòng Tài Xỉu chỉ hoạt động trong nhóm chat. Vui lòng thêm bot vào một nhóm và sử dụng lệnh /taixiuroom trong đó.');
    }
    
    // Check if user is registered
    if (!Database.users.exists(userId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ Bạn chưa đăng ký tài khoản.' });
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    // Check if user is banned
    const user = Database.users.get(userId);
    if (user && user.banned) {
      bot.answerCallbackQuery(query.id, { text: '❌ Tài khoản của bạn đã bị cấm.' });
      return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
    }
    
    // Redirect to /taixiuroom command
    bot.answerCallbackQuery(query.id, { text: '🎲 Đang tạo phòng Tài Xỉu...' });
    
    // Hiển thị nút bắt đầu thay vì tự động bắt đầu phiên mới
    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    
    // Send instructions message
    const instructions = `🎲 HƯỚNG DẪN THAM GIA PHÒNG TÀI XỈU 🎲

Để đặt cược, sử dụng các lệnh sau:
/tx tai [số tiền] - Đặt cược Tài (hoặc T [số tiền])
/tx xiu [số tiền] - Đặt cược Xỉu (hoặc X [số tiền])
/tx chan [số tiền] - Đặt cược Chẵn (hoặc C [số tiền])
/tx le [số tiền] - Đặt cược Lẻ (hoặc L [số tiền])

🎯 LUẬT CHƠI:
- Tổng 3 xúc xắc > 10 là Tài, ≤ 10 là Xỉu
- Tổng 3 xúc xắc chia hết cho 2 là Chẵn, còn lại là Lẻ
- Tỷ lệ thắng cược Tài/Xỉu: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU} lần tiền cược
- Tỷ lệ thắng cược Chẵn/Lẻ: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE} lần tiền cược
- Thời gian mỗi vòng: ${config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME} giây
- Phòng sẽ tự động bắt đầu khi có người đặt cược đầu tiên`;

    bot.sendMessage(chatId, instructions);
    return;
  } else if (data.startsWith('bet_taixiu_')) {
    // Handle Tài Xỉu bets
    const [_, game, bet, amount] = data.split('_');
    const betAmount = parseInt(amount);
    
    // Get user
    const user = Database.users.get(userId);
    if (!user) {
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    // Check if user is banned
    if (user.banned) {
      return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
    }
    
    // Sử dụng emoji 🎲 của Telegram để tung xúc xắc thật
    await bot.sendMessage(chatId, '🎲 Đang tung xúc xắc...');
    // Sử dụng API tung xúc xắc của Telegram
    await bot.sendDice(chatId, { emoji: '🎲' });
    await bot.sendDice(chatId, { emoji: '🎲' });
    await bot.sendDice(chatId, { emoji: '🎲' });
    
    // Play the game
    const result = await playTaiXiu(user, bet, betAmount);
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎲 Chơi lại Tài', callback_data: `bet_taixiu_tai_${betAmount}` },
           { text: '🎲 Chơi lại Xỉu', callback_data: `bet_taixiu_xiu_${betAmount}` }],
          [{ text: '💰 Xem số dư', callback_data: 'check_balance' },
           { text: '🎮 Trò chơi khác', callback_data: 'show_games' }]
        ]
      }
    });
  } else if (data === 'check_balance') {
    // Check user balance
    const user = Database.users.get(userId);
    if (!user) {
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    bot.sendMessage(chatId, `💰 SỐ DƯ TÀI KHOẢN 💰\n\n👤 Người chơi: ${user.first_name}\n💵 Số dư: ${formatCurrency(user.balance)}\n🧮 Tổng cược: ${formatCurrency(user.totalBet)}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 Trò chơi', callback_data: 'show_games' },
           { text: '🎁 Điểm danh', callback_data: 'daily_checkin' }]
        ]
      }
    });
  } else if (data === 'daily_checkin') {
    // Daily check-in
    const result = await userCommands.dailyCheckin(userId);
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 Trò chơi', callback_data: 'show_games' },
           { text: '💰 Xem số dư', callback_data: 'check_balance' }]
        ]
      }
    });
  } else if (data === 'show_games') {
    // Show games list
    const gamesKeyboard = [
      [{ text: '🎲 Tài Xỉu', callback_data: 'game_taixiu' },
       { text: '🎮 Chẵn Lẻ', callback_data: 'game_chanle' }],
      [{ text: '🔢 Đoán Số', callback_data: 'game_doanso' },
       { text: '🎰 Slot Machine', callback_data: 'game_slot' }],
      [{ text: '🎲 Phòng Tài Xỉu', callback_data: 'game_taixiuroom' }],
      [{ text: '💰 Xem số dư', callback_data: 'check_balance' }]
    ];
    
    bot.sendMessage(chatId, `🎮 DANH SÁCH TRÒ CHƠI 🎮\n\nChọn một trò chơi để bắt đầu:`, {
      reply_markup: {
        inline_keyboard: gamesKeyboard
      }
    });
  } else if (data === 'game_taixiu') {
    // Show Tài Xỉu options
    const betOptions = [
      [{ text: '🎲 Tài 10K', callback_data: 'bet_taixiu_tai_10000' }, { text: '🎲 Xỉu 10K', callback_data: 'bet_taixiu_xiu_10000' }],
      [{ text: '🎲 Tài 20K', callback_data: 'bet_taixiu_tai_20000' }, { text: '🎲 Xỉu 20K', callback_data: 'bet_taixiu_xiu_20000' }],
      [{ text: '🎲 Tài 50K', callback_data: 'bet_taixiu_tai_50000' }, { text: '🎲 Xỉu 50K', callback_data: 'bet_taixiu_xiu_50000' }],
      [{ text: '🎲 Tài 100K', callback_data: 'bet_taixiu_tai_100000' }, { text: '🎲 Xỉu 100K', callback_data: 'bet_taixiu_xiu_100000' }],
      [{ text: '🔙 Quay lại', callback_data: 'show_games' }, { text: '💰 Xem số dư', callback_data: 'check_balance' }]
    ];
    
    bot.sendMessage(chatId, `🎲 GAME TÀI XỈU 🎲

Luật chơi:
- Bot sẽ tung 3 xúc xắc
- Tổng điểm dưới 10 là Xỉu ⚫️
- Tổng điểm từ 11 trở lên là Tài ⚪️
- Tỷ lệ thắng: 1.8 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  } else if (data === 'game_chanle') {
    // Show Chẵn Lẻ options
    const betOptions = [
      [{ text: '🔴 Chẵn 10K', callback_data: 'bet_chanle_chan_10000' }, { text: '🔵 Lẻ 10K', callback_data: 'bet_chanle_le_10000' }],
      [{ text: '🔴 Chẵn 20K', callback_data: 'bet_chanle_chan_20000' }, { text: '🔵 Lẻ 20K', callback_data: 'bet_chanle_le_20000' }],
      [{ text: '🔴 Chẵn 50K', callback_data: 'bet_chanle_chan_50000' }, { text: '🔵 Lẻ 50K', callback_data: 'bet_chanle_le_50000' }],
      [{ text: '🔴 Chẵn 100K', callback_data: 'bet_chanle_chan_100000' }, { text: '🔵 Lẻ 100K', callback_data: 'bet_chanle_le_100000' }],
      [{ text: '🔙 Quay lại', callback_data: 'show_games' }, { text: '💰 Xem số dư', callback_data: 'check_balance' }]
    ];
    
    bot.sendMessage(chatId, `🎮 GAME CHẴN LẺ 🎮

Luật chơi:
- Bot sẽ tạo một số ngẫu nhiên từ 1-100
- Nếu số chẵn (chia hết cho 2) và bạn đặt "chan", bạn thắng
- Nếu số lẻ (không chia hết cho 2) và bạn đặt "le", bạn thắng
- Tỷ lệ thắng: 1.9 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  } else if (data === 'game_doanso') {
    // Show Đoán Số options
    // Tạo buttons cho tất cả số từ 1-10
    const numberButtons = [];
    const betAmount = 50000; // Default bet amount
    
    // Tạo hàng thứ nhất: 1-5
    const row1 = [];
    for (let i = 1; i <= 5; i++) {
      row1.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    numberButtons.push(row1);
    
    // Tạo hàng thứ hai: 6-10
    const row2 = [];
    for (let i = 6; i <= 10; i++) {
      row2.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    numberButtons.push(row2);
    
    // Tạo các lựa chọn mức cược
    const row3 = [
      { text: '💵 10K', callback_data: 'doanso_amount_10000' },
      { text: '💵 20K', callback_data: 'doanso_amount_20000' },
      { text: '💵 50K', callback_data: 'doanso_amount_50000' },
      { text: '💵 100K', callback_data: 'doanso_amount_100000' }
    ];
    numberButtons.push(row3);
    
    // Các tùy chọn khác
    const row4 = [
      { text: '🔙 Quay lại', callback_data: 'show_games' }, 
      { text: '💰 Xem số dư', callback_data: 'check_balance' }
    ];
    numberButtons.push(row4);
    
    bot.sendMessage(chatId, `🔢 GAME ĐOÁN SỐ 🔢

Luật chơi:
- Chọn một số từ 1 đến 10
- Nếu đoán đúng, bạn thắng 7 lần tiền cược
- Tỷ lệ thắng: 1/10 (10%)`, {
      reply_markup: {
        inline_keyboard: numberButtons
      }
    });
  } else if (data === 'game_slot') {
    // Show Slot Machine options
    const betOptions = [
      [
        { text: '🎰 Quay 10K', callback_data: 'bet_slot_10000' },
        { text: '🎰 Quay 20K', callback_data: 'bet_slot_20000' }
      ],
      [
        { text: '🎰 Quay 50K', callback_data: 'bet_slot_50000' },
        { text: '🎰 Quay 100K', callback_data: 'bet_slot_100000' }
      ],
      [
        { text: '🔙 Quay lại', callback_data: 'show_games' },
        { text: '💰 Xem số dư', callback_data: 'check_balance' }
      ]
    ];
    
    bot.sendMessage(chatId, `🎰 GAME SLOT MACHINE 🎰

Luật chơi:
- Bot sẽ quay 3 biểu tượng ngẫu nhiên 
- Hai ký tự giống nhau: 1.5 lần tiền cược
- Ba ký tự giống nhau: 5 lần tiền cược
- Jackpot (777): 10 lần tiền cược`, {
      reply_markup: {
        inline_keyboard: betOptions
      }
    });
  } else if (data.startsWith('bet_chanle_')) {
    // Handle Chẵn Lẻ bets
    const [_, game, bet, amount] = data.split('_');
    const betAmount = parseInt(amount);
    
    // Get user
    const user = Database.users.get(userId);
    if (!user) {
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    // Check if user is banned
    if (user.banned) {
      return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
    }
    
    // Sử dụng emoji 🎲 của Telegram để tung xúc xắc thật
    await bot.sendMessage(chatId, '🎲 Đang tung xúc xắc...');
    // Sử dụng API tung xúc xắc của Telegram
    await bot.sendDice(chatId, { emoji: '🎲' });
    await bot.sendDice(chatId, { emoji: '🎲' });
    
    // Play the game
    const result = await playChanLe(user, bet, betAmount);
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔴 Chơi lại Chẵn', callback_data: `bet_chanle_chan_${betAmount}` },
           { text: '🔵 Chơi lại Lẻ', callback_data: `bet_chanle_le_${betAmount}` }],
          [{ text: '💰 Xem số dư', callback_data: 'check_balance' },
           { text: '🎮 Trò chơi khác', callback_data: 'show_games' }]
        ]
      }
    });
  } else if (data.startsWith('bet_doanso_')) {
    // Handle Đoán Số bets
    const [_, game, guess, amount] = data.split('_');
    const betAmount = parseInt(amount);
    
    // Get user
    const user = Database.users.get(userId);
    if (!user) {
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    // Check if user is banned
    if (user.banned) {
      return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
    }
    
    // Sử dụng emoji 🎲 của Telegram để tung xúc xắc thật
    await bot.sendMessage(chatId, '🎲 Đang tung xúc xắc...');
    // Sử dụng API tung xúc xắc của Telegram
    await bot.sendDice(chatId, { emoji: '🎲' });
    await bot.sendDice(chatId, { emoji: '🎲' });
    
    // Play the game
    const result = await playDoanSo(user, guess, betAmount);
    
    // Tạo inline buttons cho kết quả
    const inlineButtons = [];
    
    // Tạo nút chơi lại
    const replayButtons = [];
    for (let i = 1; i <= 5; i++) {
      replayButtons.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    inlineButtons.push(replayButtons);
    
    const replayButtons2 = [];
    for (let i = 6; i <= 10; i++) {
      replayButtons2.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${betAmount}` });
    }
    inlineButtons.push(replayButtons2);
    
    // Nút điều hướng khác
    inlineButtons.push([
      { text: '💰 Xem số dư', callback_data: 'check_balance' },
      { text: '🎮 Trò chơi khác', callback_data: 'show_games' }
    ]);
    
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: inlineButtons
      }
    });
  } else if (data.startsWith('doanso_amount_')) {
    // Handle Đoán Số amount selection
    const amount = parseInt(data.split('_')[2]);
    
    // Tạo buttons cho tất cả số từ 1-10 với mức cược đã chọn
    const numberButtons = [];
    
    // Tạo hàng thứ nhất: 1-5
    const row1 = [];
    for (let i = 1; i <= 5; i++) {
      row1.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${amount}` });
    }
    numberButtons.push(row1);
    
    // Tạo hàng thứ hai: 6-10
    const row2 = [];
    for (let i = 6; i <= 10; i++) {
      row2.push({ text: `🎲 ${i}`, callback_data: `bet_doanso_${i}_${amount}` });
    }
    numberButtons.push(row2);
    
    // Các tùy chọn khác
    const row3 = [
      { text: '🔙 Quay lại', callback_data: 'game_doanso' }, 
      { text: '💰 Xem số dư', callback_data: 'check_balance' }
    ];
    numberButtons.push(row3);
    
    bot.sendMessage(chatId, `🔢 GAME ĐOÁN SỐ 🔢

Bạn đã chọn mức cược: ${formatCurrency(amount)}
Hãy chọn một số từ 1 đến 10:`, {
      reply_markup: {
        inline_keyboard: numberButtons
      }
    });
  } else if (data.startsWith('bet_slot_')) {
    // Handle Slot Machine bets
    const amount = parseInt(data.split('_')[2]);
    
    // Get user
    const user = Database.users.get(userId);
    if (!user) {
      return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
    }
    
    // Check if user is banned
    if (user.banned) {
      return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
    }
    
    // Hiệu ứng slot machine quay với emoji 🎰 của Telegram
    await bot.sendMessage(chatId, '🎰 Đang quay Slot Machine...');
    
    // Sử dụng emoji 🎰 của Telegram để tạo hiệu ứng quay slot thật
    await bot.sendDice(chatId, { emoji: '🎰' });
    
    // Play the game
    const result = await playSlotMachine(user, amount);
    
    // Tạo nút bấm sau khi chơi
    const replayButtons = [
      [
        { text: '🎰 Quay lại cùng mức', callback_data: `bet_slot_${amount}` },
        { text: '💰 Xem số dư', callback_data: 'check_balance' }
      ],
      [
        { text: '🎮 Trò chơi khác', callback_data: 'show_games' },
        { text: '🔄 Đổi mức cược', callback_data: 'game_slot' }
      ]
    ];
    
    bot.sendMessage(chatId, result.message, {
      reply_markup: {
        inline_keyboard: replayButtons
      }
    });
  } else if (data === 'cancel_delete_account') {
    // Handle cancel delete account
    bot.sendMessage(chatId, '❌ Đã hủy xóa tài khoản.', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Xem số dư', callback_data: 'check_balance' },
            { text: '🎮 Trò chơi', callback_data: 'show_games' }
          ]
        ]
      }
    });
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Log all messages for debugging (remove in production)
bot.on('message', (msg) => {
  console.log(`[${new Date().toISOString()}] ${msg.from.id} (${msg.from.first_name}): ${msg.text || 'Non-text message'}`);
});

// Process /taixiuroom command - Starts a Tài Xỉu Room in a group chat
bot.onText(/\/taixiuroom/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if message is from a group chat
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, '❌ Lệnh này chỉ có thể sử dụng trong các nhóm chat.');
  }
  
  // Check if user is registered
  if (!Database.users.exists(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  const user = Database.users.get(userId);
  if (user && user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  // Send instructions message
  const instructions = `🎲 PHÒNG TÀI XỈU 🎲

Bạn có muốn bắt đầu phiên đặt cược mới không?

Để đặt cược, sử dụng các lệnh sau:
/tx tai [số tiền] - Đặt cược Tài (hoặc T [số tiền])
/tx xiu [số tiền] - Đặt cược Xỉu (hoặc X [số tiền])
/tx chan [số tiền] - Đặt cược Chẵn (hoặc C [số tiền])
/tx le [số tiền] - Đặt cược Lẻ (hoặc L [số tiền])

🎯 LUẬT CHƠI:
- Tổng 3 xúc xắc > 10 là Tài, ≤ 10 là Xỉu
- Tổng 3 xúc xắc chia hết cho 2 là Chẵn, còn lại là Lẻ
- Tỷ lệ thắng cược Tài/Xỉu: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU} lần tiền cược
- Tỷ lệ thắng cược Chẵn/Lẻ: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE} lần tiền cược
- Thời gian mỗi vòng: ${config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME} giây
- Phòng sẽ tự động bắt đầu khi có người đặt cược đầu tiên`;

  // Nút để bắt đầu game mới
  const keyboard = {
    inline_keyboard: [
      [{ text: '▶️ Bắt đầu phiên mới', callback_data: 'start_taixiu_room' }]
    ]
  };

  bot.sendMessage(chatId, instructions, { reply_markup: keyboard });
});



// Xử lý đặt cược trong phòng Tài Xỉu - cú pháp đầy đủ /tx tai 10000
bot.onText(/\/tx (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if message is from a group chat
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, '❌ Lệnh này chỉ có thể sử dụng trong các nhóm chat.');
  }
  
  // Check if user is registered
  if (!Database.users.exists(userId)) {
    return bot.sendMessage(chatId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  const user = Database.users.get(userId);
  if (user && user.banned) {
    return bot.sendMessage(chatId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  // Parse bet type and amount
  const params = match[1].trim().split(/\s+/);
  if (params.length < 2) {
    return bot.sendMessage(chatId, '❌ Sai cú pháp. Vui lòng sử dụng: /tx [tai/xiu/chan/le] [số tiền]');
  }
  
  const betType = params[0].toLowerCase();
  const betAmount = parseInt(params[1].replace(/\D/g, ''));
  
  // Map lệnh
  let mappedBetType = betType;
  if (!['tai', 'xiu', 'chan', 'le'].includes(betType)) {
    return bot.sendMessage(chatId, '❌ Loại cược không hợp lệ. Vui lòng chọn: tai, xiu, chan hoặc le.');
  }
  
  if (isNaN(betAmount) || betAmount <= 0) {
    return bot.sendMessage(chatId, '❌ Số tiền cược không hợp lệ. Vui lòng nhập một số dương.');
  }
  
  // Nếu phòng chưa hoạt động, hãy bắt đầu một phiên mới
  const roomState = taixiuRoom.getRoomState(chatId);
  if (!roomState || !roomState.isActive) {
    try {
      await taixiuRoom.startNewRound(bot, chatId);
      await bot.sendMessage(chatId, '🎲 Đã tự động bắt đầu phiên mới vì có người đặt cược!');
    } catch (error) {
      console.error('Error auto-starting Tài Xỉu room:', error);
      return bot.sendMessage(chatId, '❌ Có lỗi xảy ra khi tự động bắt đầu phiên mới.');
    }
  }
  
  // Place bet in Tài Xỉu Room
  const result = await taixiuRoom.placeBet(bot, msg, userId, mappedBetType, betAmount);
  
  // Send result message only to the user who placed the bet
  bot.sendMessage(userId, result.message);
  
  // If in a group chat, delete the original command message to reduce spam
  if (result.success && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    try {
      bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    } catch (err) {
      console.log('Could not delete message:', err);
    }
  }
});

// Xử lý cú pháp ngắn gọn: T 10000, X 10000, C 10000, L 10000
bot.onText(/^([TtXxCcLl])\s+(\d+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Check if message is from a group chat
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return; // Bỏ qua lệnh nếu không phải trong nhóm chat
  }
  
  // Check if user is registered
  if (!Database.users.exists(userId)) {
    return bot.sendMessage(userId, '❌ Bạn chưa đăng ký tài khoản. Vui lòng sử dụng lệnh /register để đăng ký.');
  }
  
  // Check if user is banned
  const user = Database.users.get(userId);
  if (user && user.banned) {
    return bot.sendMessage(userId, '❌ Tài khoản của bạn đã bị cấm.');
  }
  
  // Parse bet type and amount
  const shortBetType = match[1].toUpperCase();
  const betAmount = parseInt(match[2].replace(/\D/g, ''));
  
  // Map lệnh ngắn sang lệnh đầy đủ
  let fullBetType;
  switch (shortBetType) {
    case 'T': fullBetType = 'tai'; break;
    case 'X': fullBetType = 'xiu'; break;
    case 'C': fullBetType = 'chan'; break;
    case 'L': fullBetType = 'le'; break;
    default: return; // Không xử lý các trường hợp khác
  }
  
  if (isNaN(betAmount) || betAmount <= 0) {
    return bot.sendMessage(userId, '❌ Số tiền cược không hợp lệ. Vui lòng nhập một số dương.');
  }
  
  // Nếu phòng chưa hoạt động, hãy bắt đầu một phiên mới
  const roomState = taixiuRoom.getRoomState(chatId);
  if (!roomState || !roomState.isActive) {
    try {
      await taixiuRoom.startNewRound(bot, chatId);
      await bot.sendMessage(chatId, '🎲 Đã tự động bắt đầu phiên mới vì có người đặt cược!');
    } catch (error) {
      console.error('Error auto-starting Tài Xỉu room:', error);
      return bot.sendMessage(chatId, '❌ Có lỗi xảy ra khi tự động bắt đầu phiên mới.');
    }
  }
  
  // Place bet in Tài Xỉu Room
  const result = await taixiuRoom.placeBet(bot, msg, userId, fullBetType, betAmount);
  
  // Send result message only to the user who placed the bet
  bot.sendMessage(userId, result.message);
  
  // If in a group chat, delete the original command message to reduce spam
  if (result.success && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    try {
      bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    } catch (err) {
      console.log('Could not delete message:', err);
    }
  }
});

console.log('Bot is running...');