module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  res.json({
    status: 'ok',
    service: 'AITChek Engine',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
};
