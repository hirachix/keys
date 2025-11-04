// api/key-info.js
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

async function loadDatabase() {
  try {
    console.log('🔍 Loading database from Gist...');
    const response = await fetch(`https://gist.githubusercontent.com/${GIST_ID}/raw/data.json`);
    
    if (!response.ok) {
      throw new Error(`Gist response: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Database loaded successfully');
    console.log('📊 Keys in database:', Object.keys(data.keys || {}));
    return data;
  } catch (error) {
    console.error('❌ Failed to load database:', error.message);
    return { keys: {}, users: {} };
  }
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    try {
      const { key } = req.query;
      
      console.log('🔍 Key info request for:', key);
      
      if (!key) {
        return res.status(400).json({ error: 'Key parameter is required' });
      }
      
      const db = await loadDatabase();
      
      console.log('🔍 Looking for key in database...');
      const keyData = db.keys[key];
      
      if (!keyData) {
        console.log('❌ Key not found:', key);
        console.log('📋 Available keys:', Object.keys(db.keys));
        return res.status(404).json({ 
          error: 'Key not found',
          available_keys: Object.keys(db.keys)
        });
      }
      
      console.log('✅ Key found:', keyData);
      
      // Get user info
      const userInfo = db.users[keyData.user_id] || {
        username: 'Unknown',
        first_name: 'Unknown User'
      };
      
      // Calculate expiry info
      const isExpired = Date.now() > keyData.expiry_date;
      const expiresIn = Math.ceil((keyData.expiry_date - Date.now()) / (1000 * 60 * 60 * 24));
      const usesLeft = keyData.max_uses - keyData.used_count;
      
      const responseData = {
        key: keyData.key,
        key_type: keyData.key_type,
        user_id: keyData.user_id,
        username: userInfo.username,
        user_name: userInfo.first_name,
        created_at: keyData.created_at,
        expiry_date: keyData.expiry_date,
        max_uses: keyData.max_uses,
        used_count: keyData.used_count,
        uses_left: usesLeft,
        status: keyData.status,
        is_expired: isExpired,
        expires_in_days: expiresIn > 0 ? expiresIn : 0,
        last_used: keyData.last_used || null
      };
      
      console.log('✅ Key info response:', responseData);
      
      res.status(200).json(responseData);
      
    } catch (error) {
      console.error('❌ Key info error:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};