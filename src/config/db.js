const mongoose = require('mongoose');

let isConnected = false;

const ensureIndexes = async (conn) => {
  try {
    const User = require('../models/User');
    // Attempt to ensure indexes safely without crashing the server if conflict occurs
    await User.init();
    console.log('[MongoDB] User indexes initialized successfully (unique phone enforced).');
  } catch (err) {
    console.error('[MongoDB Index Warning] Could not automatically ensure User indexes:', err.message);
  }
};

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/loan_recovery_updated';
  
  try {
    mongoose.set('strictQuery', false);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 7000,
    });
    isConnected = true;
    console.log(`[MongoDB] Connected to database: ${conn.connection.host}/${conn.connection.name}`);

    // Safe index verification in background
    ensureIndexes(conn).catch(() => {});

    return conn;
  } catch (err) {
    console.error(`[MongoDB Error] Failed to connect to MongoDB: ${err.message}`);
    isConnected = false;
    throw err;
  }
};

const getIsConnected = () => isConnected;

module.exports = { connectDB, getIsConnected };
