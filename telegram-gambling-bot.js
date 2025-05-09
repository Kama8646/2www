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

// Create random number generator 
const random = new Random();

// Config
const config = {
  // Telegram bot token - get from environment variables 
  TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  
  // Admin user IDs (comma-separated in env)
  ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()),
  
  // Game settings
  GAMES: {
    TAIXIU: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.8, // Win multiplier
    },
    CHANLE: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.9, // Win multiplier
    },
    DOANSO: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIER: 7, // Win multiplier
    },
    SLOTMACHINE: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIERS: {
        TWO_SAME: 1.5,
        THREE_SAME: 5,
        JACKPOT: 10,
      },
    },
  },
  
  // Daily check-in bonus amount
  DAILY_BONUS: 1000,
  
  // Initial balance for new users
  INITIAL_BALANCE: 10000,
  
  // Database file
  DB_FILE: 'database.json',
};

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
  const adminId = msg.from.id;
  
  // Check if user is admin
  if (!isAdmin(adminId)) {
    return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
  }
  
  const result = await adminCommands.getStats(adminId);
  bot.sendMessage(chatId, result.message);
});

// Handle inline buttons (callback queries)
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;
  
  // Acknowledge the callback query
  bot.answerCallbackQuery(query.id);
  
  // Handle different callback data
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
    
    // Forward to taixiuRoom
    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    await taixiuRoom.startNewRound(bot, chatId);
    
    // Send instructions message
    const instructions = `🎲 HƯỚNG DẪN THAM GIA PHÒNG TÀI XỈU 🎲

Để đặt cược, sử dụng các lệnh sau:
/tx tai [số tiền] - Đặt cược Tài
/tx xiu [số tiền] - Đặt cược Xỉu
/tx chan [số tiền] - Đặt cược Chẵn
/tx le [số tiền] - Đặt cược Lẻ

🎯 LUẬT CHƠI:
- Tổng 3 xúc xắc > 10 là Tài, ≤ 10 là Xỉu
- Tổng 3 xúc xắc chia hết cho 2 là Chẵn, còn lại là Lẻ
- Tỷ lệ thắng cược Tài/Xỉu: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU} lần tiền cược
- Tỷ lệ thắng cược Chẵn/Lẻ: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE} lần tiền cược
- Thời gian mỗi vòng: ${config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME} giây`;

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
  
  // Start a new Tài Xỉu room
  await taixiuRoom.startNewRound(bot, chatId);
  
  // Send instructions message
  const instructions = `🎲 HƯỚNG DẪN THAM GIA PHÒNG TÀI XỈU 🎲

Để đặt cược, sử dụng các lệnh sau:
/tx tai [số tiền] - Đặt cược Tài
/tx xiu [số tiền] - Đặt cược Xỉu
/tx chan [số tiền] - Đặt cược Chẵn
/tx le [số tiền] - Đặt cược Lẻ

🎯 LUẬT CHƠI:
- Tổng 3 xúc xắc > 10 là Tài, ≤ 10 là Xỉu
- Tổng 3 xúc xắc chia hết cho 2 là Chẵn, còn lại là Lẻ
- Tỷ lệ thắng cược Tài/Xỉu: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_TAIXIU} lần tiền cược
- Tỷ lệ thắng cược Chẵn/Lẻ: ${config.GAMES.TAIXIU_ROOM.MULTIPLIER_CHANLE} lần tiền cược
- Thời gian mỗi vòng: ${config.GAMES.TAIXIU_ROOM.COUNTDOWN_TIME} giây`;

  bot.sendMessage(chatId, instructions);
});

// Process /tx command - Place bets in Tài Xỉu Room
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
  
  if (!['tai', 'xiu', 'chan', 'le'].includes(betType)) {
    return bot.sendMessage(chatId, '❌ Loại cược không hợp lệ. Vui lòng chọn: tai, xiu, chan hoặc le.');
  }
  
  if (isNaN(betAmount) || betAmount <= 0) {
    return bot.sendMessage(chatId, '❌ Số tiền cược không hợp lệ. Vui lòng nhập một số dương.');
  }
  
  // Place bet in Tài Xỉu Room
  const result = await taixiuRoom.placeBet(bot, msg, userId, betType, betAmount);
  
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

console.log('Bot is running...');require('dotenv').config();

module.exports = {
  // Telegram bot token - get from environment variables 
  TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  
  // Admin user IDs (comma-separated in env)
  ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()),
  
  // Game settings
  GAMES: {
    TAIXIU: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.8, // Win multiplier
    },
    TAIXIU_ROOM: {
      MIN_BET: 5000,
      MAX_BET: 1000000,
      MULTIPLIER_TAIXIU: 1.95, // Win multiplier for Tài/Xỉu
      MULTIPLIER_CHANLE: 1.90, // Win multiplier for Chẵn/Lẻ
      COUNTDOWN_TIME: 60, // Default countdown time in seconds
      POT_CONTRIBUTION: 0.05, // 5% of lost bets go to pot
    },
    CHANLE: {
      MIN_BET: 10000,
      MAX_BET: 1000000,
      MULTIPLIER: 1.9, // Win multiplier
    },
    DOANSO: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIER: 7, // Win multiplier
    },
    SLOTMACHINE: {
      MIN_BET: 10000,
      MAX_BET: 500000,
      MULTIPLIERS: {
        TWO_SAME: 1.5,
        THREE_SAME: 5,
        JACKPOT: 10,
      },
    },
  },
  
  // Daily check-in bonus amount
  DAILY_BONUS: 1000,
  
  // Initial balance for new users
  INITIAL_BALANCE: 10000,
  
  // Database file
  DB_FILE: 'database.json',
};
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const config = require('./config');
const moment = require('moment');

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

module.exports = Database;
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
${roomState.history.slice(0, 5).map((h, i) => 
  `#${i+1}: ${h.dice.join(' | ')} = ${h.sum} (${h.sum > 10 ? 'Tài' : 'Xỉu'} | ${h.sum % 2 === 0 ? 'Chẵn' : 'Lẻ'})`
).join('\n')}

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
  
  // Gửi thông báo kết quả tổng hợp
  const kqTaiXiu = sum > 10 ? "TÀI" : "XỈU";
  const kqChanLe = sum % 2 === 0 ? "CHẴN" : "LẺ";
  
  await bot.sendMessage(chatId, 
    `🎲 KẾT QUẢ PHIÊN #${roomState.roundId.toString().slice(-5)}:\n` +
    `┣➤ Xúc xắc: ${diceValues.join(' + ')} = ${sum}\n` +
    `┣➤ Kết quả: ${kqTaiXiu} - ${kqChanLe}\n` +
    `┗➤ Luật: Tài (>10), Xỉu (≤10)`
  );
  
  // Process all bets and distribute winnings
  // Tài: tổng > 10, Xỉu: tổng <= 10
  const isTai = sum > 10;
  const isXiu = sum <= 10;
  // Chẵn: chia hết cho 2, Lẻ: không chia hết cho 2
  const isChan = sum % 2 === 0;
  
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
  
  // Start new round after a delay
  setTimeout(() => {
    startNewRound(bot, chatId);
  }, 10000);
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
  placeBet
};const moment = require('moment');

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
  const diceWithEmojis = dice.map(num => `${diceEmojis[num-1]} ${num}`);
  return `${diceWithEmojis.join(' ')} | ${result === 'tai' ? 'Tài ⚪️' : 'Xỉu ⚫️'}`;
};

// Format game result for Chẵn Lẻ
const formatChanLeResult = (number, result) => {
  return `${number} | ${result === 'chan' ? 'Chẵn 🔴' : 'Lẻ 🔵'}`;
};

// Format game result for Đoán Số
const formatDoanSoResult = (number, userGuess) => {
  return `${number} | Bạn đoán: ${userGuess}`;
};

// Format game result for Slot Machine
const formatSlotResult = (symbols) => {
  return `🎰 [ ${symbols.join(' | ')} ] 🎰`;
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
const config = require('../config');

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

module.exports = {
  isAdmin,
  isValidBetAmount,
  hasEnoughBalance,
  isValidTaiXiuBet,
  isValidChanLeBet,
  isValidDoanSoBet,
  canClaimDailyBonus
};
const db = require('../database');
const validators = require('../utils/validators');
const formatters = require('../utils/formatters');

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

module.exports = {
  addMoney,
  banUser,
  unbanUser,
  createGiftcode,
  getStats
};
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
