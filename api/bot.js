// api/bot.js
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const VERCEL_URL = process.env.VERCEL_URL;

// Validate environment variables
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Add error handling
bot.catch((err, ctx) => {
  console.error(`❌ Error for ${ctx.updateType}:`, err);
});

// ==================== ATOMIC DATABASE OPERATIONS ====================

let dbMutex = Promise.resolve(); // Simple mutex for database operations

async function atomicDBOperation(operation) {
  // Acquire lock
  dbMutex = dbMutex.then(async () => {
    try {
      await operation();
    } catch (error) {
      console.error('❌ Atomic operation failed:', error);
      throw error;
    }
  });
  
  return dbMutex;
}

async function loadDatabase() {
  try {
    console.log('📁 Loading database from Gist...');
    const response = await fetch(`https://gist.githubusercontent.com/${GIST_ID}/raw/data.json?t=${Date.now()}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Ensure all required structures exist
    const ensuredData = {
      users: data.users || {},
      keys: data.keys || {},
      requests: data.requests || {},
      usage: data.usage || [],
      settings: data.settings || {
        key_expiry: {
          SINGLE: 30,
          PREMIUM: 90,
          STAFF: 365,
          BETA: 60,
          TEST: 7
        }
      },
      lastUpdated: data.lastUpdated || Date.now()
    };
    
    console.log('✅ Database loaded - Stats:', {
      users: Object.keys(ensuredData.users).length,
      keys: Object.keys(ensuredData.keys).length,
      requests: Object.keys(ensuredData.requests).length
    });
    
    return ensuredData;
  } catch (error) {
    console.log('⚠️ Creating fresh database:', error.message);
    return {
      users: {},
      keys: {},
      requests: {},
      usage: [],
      settings: {
        key_expiry: {
          SINGLE: 30,
          PREMIUM: 90,
          STAFF: 365,
          BETA: 60,
          TEST: 7
        }
      },
      lastUpdated: Date.now()
    };
  }
}

async function saveDatabase(data) {
  try {
    data.lastUpdated = Date.now();
    console.log('💾 Saving database...');
    
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Telegram-Bot'
      },
      body: JSON.stringify({
        files: {
          'data.json': {
            content: JSON.stringify(data, null, 2)
          }
        }
      })
    });
    
    if (response.ok) {
      console.log('✅ Database saved successfully');
      const savedData = await response.json();
      return true;
    } else {
      const errorText = await response.text();
      console.error('❌ Save failed:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('❌ Save error:', error.message);
    return false;
  }
}

// Atomic database operations
async function atomicLoad() {
  return await atomicDBOperation(async () => {
    return await loadDatabase();
  });
}

async function atomicSave(data) {
  return await atomicDBOperation(async () => {
    return await saveDatabase(data);
  });
}

async function atomicUpdate(updateFunction) {
  return await atomicDBOperation(async () => {
    const db = await loadDatabase();
    const result = await updateFunction(db);
    const saved = await saveDatabase(db);
    return { result, saved };
  });
}

// ==================== UTILITY FUNCTIONS ====================

function generateKey(type = 'SINGLE') {
  const prefixes = { 
    'SINGLE': 'RED', 
    'PREMIUM': 'PRE', 
    'STAFF': 'STAFF',
    'BETA': 'BETA',
    'TEST': 'TEST'
  };
  const prefix = prefixes[type] || 'RED';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const newKey = `${prefix}-${result}`;
  console.log('🔑 Generated key:', newKey);
  return newKey;
}

function getExpiryDate(days) {
  const expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
  return expiry;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days} days ago`;
  if (hours > 0) return `${hours} hours ago`;
  return `${minutes} minutes ago`;
}

function getKeyExpiryDays(keyType, db) {
  const defaultExpiry = {
    SINGLE: 30,
    PREMIUM: 90, 
    STAFF: 365,
    BETA: 60,
    TEST: 7
  };
  
  return db.settings?.key_expiry?.[keyType] || defaultExpiry[keyType] || 30;
}

// ==================== USER MANAGEMENT ====================

async function ensureUserExists(user) {
  return await atomicUpdate(async (db) => {
    const userId = user.id;
    
    if (!db.users[userId]) {
      console.log('👤 Creating new user:', userId, user.first_name);
      db.users[userId] = {
        id: userId,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name || '',
        join_date: Date.now(),
        last_seen: Date.now()
      };
      return { created: true, user: db.users[userId] };
    } else {
      // Update existing user
      db.users[userId].last_seen = Date.now();
      db.users[userId].username = user.username || db.users[userId].username;
      db.users[userId].first_name = user.first_name || db.users[userId].first_name;
      return { created: false, user: db.users[userId] };
    }
  });
}

// ==================== KEY GENERATION ====================

async function createKeyForUser(userId, keyType, requestData = null) {
  return await atomicUpdate(async (db) => {
    // Ensure user exists
    if (!db.users[userId]) {
      if (requestData) {
        db.users[userId] = {
          id: parseInt(userId),
          username: requestData.username,
          first_name: requestData.first_name,
          last_name: '',
          join_date: Date.now(),
          last_seen: Date.now()
        };
      } else {
        db.users[userId] = {
          id: parseInt(userId),
          username: 'unknown',
          first_name: 'Unknown User',
          last_name: '',
          join_date: Date.now(),
          last_seen: Date.now()
        };
      }
    }
    
    const user = db.users[userId];
    const newKey = generateKey(keyType);
    const expiryDays = getKeyExpiryDays(keyType, db);
    const maxUses = keyType === 'STAFF' ? 999 : (keyType === 'PREMIUM' ? 3 : 1);
    
    // Create key
    db.keys[newKey] = {
      key: newKey,
      user_id: parseInt(userId),
      key_type: keyType,
      created_at: Date.now(),
      expiry_date: getExpiryDate(expiryDays),
      max_uses: maxUses,
      used_count: 0,
      status: 'active',
      last_used: null
    };
    
    // Remove request if exists
    if (db.requests && db.requests[userId]) {
      delete db.requests[userId];
    }
    
    console.log('✅ Key created:', {
      key: newKey,
      user: user.first_name,
      type: keyType,
      expiry: expiryDays + ' days'
    });
    
    return { 
      key: newKey, 
      user: user,
      expiryDays: expiryDays,
      maxUses: maxUses 
    };
  });
}

// ==================== BOT COMMANDS ====================

bot.start(async (ctx) => {
  try {
    console.log('🟢 /start from:', ctx.from.id, ctx.from.first_name);
    
    const { result } = await ensureUserExists(ctx.from);
    
    if (ctx.from.id.toString() === ADMIN_ID) {
      const db = await atomicLoad();
      await ctx.replyWithHTML(
        `👑 <b>Admin Panel</b>\n\n` +
        `Welcome back, <b>${ctx.from.first_name}</b>!\n\n` +
        `<b>Commands:</b>\n` +
        `/request - Request key\n` +
        `/mystats - Your stats\n` +
        `/admin - Dashboard\n` +
        `/generate - Create key\n` +
        `/expiry - Set expiry\n\n` +
        `<i>Atomic DB System ✅</i>`
      );
    } else {
      await ctx.replyWithHTML(
        `🤖 <b>Key Management System</b>\n\n` +
        `Hello <b>${ctx.from.first_name}</b>!\n\n` +
        `<b>Commands:</b>\n` +
        `/request - Request key\n` +
        `/mystats - Check keys\n\n` +
        `<i>Account ready! ✅</i>`
      );
    }
  } catch (error) {
    console.error('Error in /start:', error);
    await ctx.reply('❌ Error. Please try again.');
  }
});

bot.command('request', async (ctx) => {
  try {
    console.log('🟢 /request from:', ctx.from.id, ctx.from.first_name);
    
    const { result: userResult } = await ensureUserExists(ctx.from);
    
    const { result: requestResult } = await atomicUpdate(async (db) => {
      const userId = ctx.from.id;
      
      // Check existing request
      if (db.requests[userId]) {
        const timeAgo = formatTimeAgo(db.requests[userId].requested_at);
        throw new Error(`PENDING_REQUEST:${timeAgo}`);
      }
      
      // Check existing active keys
      const userKeys = Object.values(db.keys).filter(k => 
        k.user_id === userId && k.status === 'active' && k.expiry_date > Date.now()
      );
      
      if (userKeys.length > 0) {
        const keyList = userKeys.map(k => `• ${k.key} (${k.key_type})`).join('\n');
        throw new Error(`ACTIVE_KEYS:${keyList}`);
      }
      
      // Create request
      db.requests[userId] = {
        user_id: userId,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        status: 'pending',
        requested_at: Date.now()
      };
      
      return { success: true };
    });
    
    // Notify admin
    if (ADMIN_ID) {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Approve SINGLE", callback_data: `approve_${ctx.from.id}_SINGLE` },
            { text: "⭐ Approve PREMIUM", callback_data: `approve_${ctx.from.id}_PREMIUM` }
          ],
          [
            { text: "🔧 Approve STAFF", callback_data: `approve_${ctx.from.id}_STAFF` },
            { text: "❌ Reject", callback_data: `reject_${ctx.from.id}` }
          ]
        ]
      };
      
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `🆕 <b>New Key Request</b>\n\n` +
        `👤 <b>User:</b> ${ctx.from.first_name}\n` +
        `🆔 <b>ID:</b> <code>${ctx.from.id}</code>\n` +
        `📛 <b>Username:</b> @${ctx.from.username || 'N/A'}\n` +
        `⏰ <b>Time:</b> ${new Date().toLocaleString()}`,
        { 
          parse_mode: 'HTML',
          reply_markup: keyboard 
        }
      );
    }
    
    await ctx.replyWithHTML('✅ <b>Request Sent!</b>\n\nYou will receive your key via DM once approved.');
    
  } catch (error) {
    if (error.message.startsWith('PENDING_REQUEST:')) {
      const timeAgo = error.message.split(':')[1];
      await ctx.reply(`⏳ You already have a pending request (${timeAgo}).`);
    } else if (error.message.startsWith('ACTIVE_KEYS:')) {
      const keyList = error.message.split(':')[1];
      await ctx.reply(`✅ You already have active keys:\n\n${keyList}\n\nUse /mystats to view them.`);
    } else {
      console.error('Error in /request:', error);
      await ctx.reply('❌ Error processing request.');
    }
  }
});

bot.command('generate', async (ctx) => {
  try {
    if (ctx.from.id.toString() !== ADMIN_ID) {
      return ctx.reply('❌ Admin only command.');
    }
    
    const args = ctx.message.text.split(' ');
    
    if (args.length < 3) {
      return ctx.replyWithHTML(
        '🔑 <b>Usage:</b> <code>/generate &lt;user_id&gt; &lt;key_type&gt;</code>\n\n' +
        '<b>Types:</b> SINGLE, PREMIUM, STAFF, BETA, TEST\n' +
        '<b>Example:</b> <code>/generate 123456789 PREMIUM</code>'
      );
    }
    
    const userId = args[1];
    const keyType = args[2].toUpperCase();
    
    if (!['SINGLE', 'PREMIUM', 'STAFF', 'BETA', 'TEST'].includes(keyType)) {
      return ctx.reply('❌ Invalid key type.');
    }
    
    console.log('🔑 Manual generation:', { userId, keyType });
    
    const { result, saved } = await createKeyForUser(userId, keyType);
    
    if (!saved) {
      throw new Error('Failed to save key');
    }
    
    // Send to user
    try {
      await bot.telegram.sendMessage(
        userId,
        `🎉 <b>New Key Generated For You!</b>\n\n` +
        `🔑 <b>Key:</b> <code>${result.key}</code>\n` +
        `📅 <b>Type:</b> ${keyType}\n` +
        `⏰ <b>Expires:</b> ${result.expiryDays} days\n` +
        `💻 <b>Uses:</b> ${result.maxUses}\n\n` +
        `⚠️ <i>Keep this key safe!</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.log('⚠️ Could not send to user:', error.message);
    }
    
    await ctx.replyWithHTML(
      `✅ <b>Key Generated!</b>\n\n` +
      `🔑 Key: <code>${result.key}</code>\n` +
      `👤 User: ${result.user.first_name}\n` +
      `📅 Type: ${keyType}\n` +
      `⏰ Expires: ${result.expiryDays} days\n` +
      `💻 Uses: ${result.maxUses}`
    );
    
  } catch (error) {
    console.error('Error in /generate:', error);
    await ctx.reply('❌ Error generating key.');
  }
});

// ==================== BUTTON HANDLER ====================

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    console.log('🟡 Button:', data);
    
    const [action, userId, keyType] = data.split('_');
    
    if (ctx.from.id.toString() !== ADMIN_ID) {
      return ctx.answerCbQuery('❌ Admin only!');
    }
    
    if (action === 'approve') {
      console.log('🟡 Approving:', { userId, keyType });
      
      const { result, saved } = await createKeyForUser(userId, keyType);
      
      if (!saved) {
        return ctx.answerCbQuery('❌ Failed to save');
      }
      
      // Send key to user
      try {
        await bot.telegram.sendMessage(
          userId,
          `🎉 <b>Your Key Has Been Approved!</b>\n\n` +
          `🔑 <b>Key:</b> <code>${result.key}</code>\n` +
          `📅 <b>Type:</b> ${keyType}\n` +
          `⏰ <b>Expires:</b> ${result.expiryDays} days\n` +
          `💻 <b>Uses:</b> ${result.maxUses}\n\n` +
          `⚠️ <i>Keep this key safe!</i>`,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.log('❌ Failed to send to user:', error.message);
      }
      
      await ctx.editMessageText(
        `✅ <b>Approved!</b>\n\n` +
        `👤 ${result.user.first_name}\n` +
        `🔑 Key: <code>${result.key}</code>\n` +
        `📅 ${keyType} | ⏰ ${result.expiryDays} days`,
        { parse_mode: 'HTML' }
      );
      
    } else if (action === 'reject') {
      await atomicUpdate(async (db) => {
        if (db.requests && db.requests[userId]) {
          const request = db.requests[userId];
          delete db.requests[userId];
          
          try {
            await bot.telegram.sendMessage(
              userId,
              `❌ <b>Request Rejected</b>\n\n` +
              `Your key request has been rejected.`,
              { parse_mode: 'HTML' }
            );
          } catch (error) {
            console.log('Failed to notify user');
          }
          
          await ctx.editMessageText(`❌ Request from ${request.first_name} rejected`);
        }
      });
    }
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Error in callback:', error);
    await ctx.answerCbQuery('❌ Error processing');
  }
});

// ==================== WEBHOOK SETUP ====================

bot.telegram.setWebhook(`${VERCEL_URL}/api/bot`).then(() => {
  console.log('✅ Webhook set successfully');
}).catch(err => {
  console.error('❌ Webhook setup failed:', err);
});

module.exports = async (req, res) => {
  console.log('🟡 Request:', req.method, req.url);
  
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(200).json({ 
        status: 'Bot is running',
        timestamp: new Date().toISOString(),
        system: 'Atomic Database v2'
      });
    }
  } catch (error) {
    console.error('❌ Handler error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};