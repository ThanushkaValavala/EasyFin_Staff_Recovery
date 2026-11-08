require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { connectDB } = require('./config/db');
const memoryStore = require('./services/store');

const authRoutes = require('./routes/authRoutes');
const agentRoutes = require('./routes/agentRoutes');
const caseRoutes = require('./routes/caseRoutes');
const recoveryRoutes = require('./routes/recoveryRoutes');
const reportRoutes = require('./routes/reportRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(morgan('dev'));

// Static files for photo evidence
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Root & Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'EasyFin Staff Recovery API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/agent', agentRoutes);
app.use('/api/v1/cases', caseRoutes);
app.use('/api/v1/assignments', caseRoutes); // Alias for specification: GET /assignments
app.use('/api/v1/recovery', recoveryRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Error]:', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'An unexpected error occurred on the server.'
  });
});

// Start Server
const startServer = async () => {
  await connectDB();
  await memoryStore.initDefaults();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 EasyFin Staff Recovery Backend Service`);
    console.log(`📡 Server running on http://0.0.0.0:${PORT}`);
    console.log(`🔍 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`====================================================`);
  });

  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
