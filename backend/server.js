require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logger to help debug mobile network payloads
app.use((req, res, next) => {
  const bodySize = req.body ? JSON.stringify(req.body).length : 0;
  console.log(`[LOG] ${req.method} ${req.url} - Payload Size: ${bodySize} bytes`);
  next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check — used by frontend to pre-warm server on page load
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// API Routes
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/stock', require('./routes/stock'));

// Catch-all: serve frontend for any non-API route
// Catch-all: serve the matching frontend page for direct navigation/refresh,
// fall back to index.html for anything else (so refreshing requests.html works)
app.get('*', (req, res) => {
  if (req.path.endsWith('requests.html')) {
    return res.sendFile(path.join(__dirname, '../frontend/requests.html'));
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Device Sales Tracker running at http://localhost:${PORT}`);
  console.log(`   API ready at http://localhost:${PORT}/api\n`);
});