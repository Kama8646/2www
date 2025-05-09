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
