const express = require("express");
const { Pool } = require('pg');
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sendEmailHandler = require("./sendEmail.js");
const sendEmailNotif = require("./sendEmailNotif");
const allowedOrigin = process.env.ALLOWED_ORIGIN;
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();
const nodemailer = require("nodemailer");
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const PORT = 3001;
const crypto = require('crypto'); // To generate random OTP
const bcrypt = require('bcrypt');
const otps = {};
app.use(express.static(path.join(__dirname, 'admin')));

const neonUrl = process.env.NEON_URL;
if (!neonUrl) {
  process.exit(1);
}
const pool = new Pool({ connectionString: neonUrl });

const RETRYABLE_PG_CODES = new Set([
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006'
]);

const isRetryablePgError = (error) => {
  if (!error) return false;
  if (error.code && RETRYABLE_PG_CODES.has(error.code)) return true;

  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('connection terminated unexpectedly') ||
    message.includes('connection reset') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('terminating connection')
  );
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryPgOperation = async (operation, options = {}) => {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 250;
  let attempt = 0;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryablePgError(error) || attempt === retries) {
        throw error;
      }

      await delay(delayMs * (attempt + 1));
      attempt += 1;
    }
  }
};

const httpServer = http.createServer(app);
const socketCorsOrigin = allowedOrigin && allowedOrigin !== '*' ? allowedOrigin : '*';
const io = new Server(httpServer, {
  cors: {
    origin: socketCorsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

io.on('connection', (socket) => {
  socket.on('join-user-room', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
  });
});


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cors({
  origin: allowedOrigin === '*' ? '*' : allowedOrigin
}));
app.use(bodyParser.json()); // Ensure this is included

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG and JPG files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: fileFilter
});

const validatePassword = (password) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
  return regex.test(password);
};

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

const verifyDatabaseConnection = async () => {
  try {
    await retryPgOperation(() => pool.query('SELECT 1'));
  } catch (error) {
    console.error('Initial database connection check failed:', error.message);
  }
};

verifyDatabaseConnection();

process.on('SIGINT', () => {
  pool.end(() => {
    process.exit(0);
  });
});

httpServer.listen(PORT, () => {

});

const notifyAdmin = async (user_id, booking_id, title, message) => {
  const client = await retryPgOperation(() => pool.connect());
  try {
      await retryPgOperation(() => client.query(
          'INSERT INTO notifications_admin (user_id, booking_id, title, message) VALUES ($1, $2, $3, $4)',
          [user_id, booking_id, title, message]
      ));
  } catch (error) {
  } finally {
      client.release();
  }
};

const notifyClient = async (user_id, booking_id, title, message) => {
  const client = await retryPgOperation(() => pool.connect());
  try {
    const result = await retryPgOperation(() => client.query(
      'INSERT INTO notifications_client (user_id, booking_id, title, message) VALUES ($1, $2, $3, $4) RETURNING *',
          [user_id, booking_id, title, message]
      ));

    io.to(`user:${user_id}`).emit('client:data-updated', {
      type: 'notification_created',
      user_id,
      booking_id,
      notification: result.rows[0]
    });
  } catch (error) {
  } finally {
      client.release();
  }
};


const mountDomainRoutes = require('./routes');

mountDomainRoutes(app, {
  pool,
  io,
  upload,
  sendEmailHandler,
  sendEmailNotif,
  notifyClient,
  notifyAdmin,
  retryPgOperation,
  validatePassword,
  bcrypt,
  crypto,
  otps,
  nodemailer,
  axios
});
