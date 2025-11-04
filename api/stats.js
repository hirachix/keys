// api/stats.js
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

async function loadDatabase() {
  try {
    const response = await fetch(`https://gist.githubusercontent.com/${GIST_ID}/raw/data.json`);
    if (!response.ok) throw new Error('Failed to load database');
    return await response.json();
  } catch (error) {
    return { keys: {}, users: {}, requests: {}, usage: [] };
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
      const db = await loadDatabase();
      
      const totalUsers = Object.keys(db.users).length;
      const totalKeys = Object.keys(db.keys).length;
      const pendingRequests = Object.keys(db.requests).length;
      const totalUsage = db.usage.length;
      
      const activeKeys = Object.values(db.keys).filter(k => 
        k.status === 'active' && Date.now() < k.expiry_date
      ).length;
      
      const keyTypes = {};
      Object.values(db.keys).forEach(key => {
        keyTypes[key.key_type] = (keyTypes[key.key_type] || 0) + 1;
      });
      
      const stats = {
        total_users: totalUsers,
        total_keys: totalKeys,
        active_keys: activeKeys,
        pending_requests: pendingRequests,
        total_usage: totalUsage,
        key_distribution: keyTypes,
        last_updated: db.lastUpdated || Date.now(),
        database_size: JSON.stringify(db).length
      };
      
      res.status(200).json(stats);
      
    } catch (error) {
      console.error('❌ Stats error:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};