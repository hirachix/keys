// api/validate.js
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

async function loadDatabase() {
  try {
    console.log('🔍 [VALIDATE] Loading database from Gist...');
    const response = await fetch(`https://gist.githubusercontent.com/${GIST_ID}/raw/data.json`);
    
    if (!response.ok) {
      throw new Error(`Gist response: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ [VALIDATE] Database loaded successfully');
    console.log('📊 [VALIDATE] Total keys in database:', Object.keys(data.keys || {}).length);
    console.log('🔑 [VALIDATE] Available keys:', Object.keys(data.keys || {}));
    return data;
  } catch (error) {
    console.error('❌ [VALIDATE] Failed to load database:', error.message);
    return { keys: {}, usage: [], users: {} };
  }
}

async function saveDatabase(data) {
  try {
    data.lastUpdated = Date.now();
    console.log('💾 [VALIDATE] Saving database...');
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: { 'data.json': { content: JSON.stringify(data, null, 2) } }
      })
    });
    
    if (response.ok) {
      console.log('✅ [VALIDATE] Database saved successfully');
      return true;
    } else {
      console.error('❌ [VALIDATE] Save failed:', response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error('❌ [VALIDATE] Save error:', error.message);
    return false;
  }
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'POST') {
    try {
      const { key, user_id, game_id, player_name } = req.body;
      
      console.log('🔑 [VALIDATE] Validation request received');
      console.log('📦 [VALIDATE] Request data:', { 
        key, 
        user_id, 
        game_id, 
        player_name 
      });
      
      if (!key) {
        console.log('❌ [VALIDATE] Key is required');
        return res.status(400).json({ valid: false, message: "Key is required" });
      }
      
      const db = await loadDatabase();
      const keyData = db.keys[key];
      
      console.log('🔍 [VALIDATE] Looking for key:', key);
      
      if (!keyData) {
        console.log('❌ [VALIDATE] Key not found:', key);
        console.log('📋 [VALIDATE] Available keys:', Object.keys(db.keys));
        return res.json({ 
          valid: false, 
          message: "Key not found",
          available_keys: Object.keys(db.keys)
        });
      }
      
      console.log('✅ [VALIDATE] Key found:', {
        key: keyData.key,
        type: keyData.key_type,
        status: keyData.status,
        used: keyData.used_count,
        max_uses: keyData.max_uses,
        expiry: new Date(keyData.expiry_date).toLocaleString()
      });
      
      if (keyData.status !== 'active') {
        console.log('❌ [VALIDATE] Key is inactive:', keyData.status);
        return res.json({ 
          valid: false, 
          message: "Key is inactive" 
        });
      }
      
      // Check expiry
      const now = Date.now();
      const isExpired = now > keyData.expiry_date;
      console.log('⏰ [VALIDATE] Expiry check:', {
        now: new Date(now).toLocaleString(),
        expiry: new Date(keyData.expiry_date).toLocaleString(),
        isExpired: isExpired
      });
      
      if (isExpired) {
        keyData.status = 'expired';
        await saveDatabase(db);
        console.log('❌ [VALIDATE] Key has expired');
        return res.json({ 
          valid: false, 
          message: "Key has expired" 
        });
      }
      
      // Check usage limit
      const usageExceeded = keyData.used_count >= keyData.max_uses;
      console.log('💻 [VALIDATE] Usage check:', {
        used: keyData.used_count,
        max_uses: keyData.max_uses,
        usageExceeded: usageExceeded
      });
      
      if (usageExceeded) {
        console.log('❌ [VALIDATE] Key usage limit reached');
        return res.json({ 
          valid: false, 
          message: "Key usage limit reached" 
        });
      }
      
      // Update usage count
      keyData.used_count++;
      keyData.last_used = now;
      console.log('📈 [VALIDATE] Updated usage count:', keyData.used_count);
      
      // Log usage
      if (!db.usage) db.usage = [];
      db.usage.push({
        key: key,
        user_id: user_id,
        game_id: game_id,
        player_name: player_name,
        timestamp: now,
        game: "Roblox"
      });
      
      console.log('📝 [VALIDATE] Usage logged');
      
      const saved = await saveDatabase(db);
      if (!saved) {
        console.log('❌ [VALIDATE] Failed to save database after validation');
        return res.json({ 
          valid: false, 
          message: "Database error" 
        });
      }
      
      const usesLeft = keyData.max_uses - keyData.used_count;
      const expiresIn = Math.ceil((keyData.expiry_date - now) / (1000 * 60 * 60 * 24));
      
      console.log('🎉 [VALIDATE] Key validated successfully!', {
        key: keyData.key,
        type: keyData.key_type,
        uses_left: usesLeft,
        expires_in_days: expiresIn
      });
      
      res.json({ 
        valid: true, 
        message: "Key validated successfully",
        key_type: keyData.key_type,
        uses_left: usesLeft,
        expires: keyData.expiry_date,
        expires_in_days: expiresIn,
        user_id: keyData.user_id
      });
      
    } catch (error) {
      console.error('❌ [VALIDATE] Validation error:', error);
      res.status(500).json({ 
        valid: false, 
        message: "Server error: " + error.message 
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};