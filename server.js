const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8888;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname));

// Healthcheck API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WakeelCheck Engine Real-Time Audit',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Explicit route for cybershield.html
app.get('/cybershield.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'cybershield.html'));
});

// Import audit handler
const auditHandler = require('./api/audit');

// Full Real Audit Endpoints (/api/audit & /api/visibility)
app.post('/api/audit', auditHandler);
app.get('/api/audit', auditHandler);
app.post('/api/visibility', auditHandler);
app.get('/api/visibility', auditHandler);

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 WakeelCheck Engine listening at http://localhost:${PORT}`);
});
