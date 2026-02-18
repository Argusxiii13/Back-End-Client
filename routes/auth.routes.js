const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.post("/api/signin", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const sql = "SELECT * FROM users WHERE email = $1"; // Use $1 for parameterized queries

  try {
    const results = await pool.query(sql, [email]);

    if (results.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = results.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    delete user.password; // Don't expose password

    res.status(200).json({ message: "Signin successful", user });
    
  } catch (err) {
    return res.status(500).json({ message: "Error during signin", error: err.message });
  }
});


router.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ message: 'Email is required' });
  }

  try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

      if (result.rows.length > 0) {
          return res.status(400).json({ message: 'Email is already registered.' });
      }

      const otp = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
      otps[email] = otp; // Store OTP in memory

      const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
          },
          pool: true,
          maxConnections: 10, // Adjust based on your needs and server capabilities
          maxMessages: 100,   // Close and recreate connection after 100 messages
      });

      const mailOptions = {
          from: process.env.SMTP_USER,
          to: email,
          subject: 'Your OTP Code',
          text: `Your OTP is: ${otp}. Please use this OTP to proceed with your action.`,
      };

      await transporter.sendMail(mailOptions);

      return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
  }
});


router.post('/api/validate-otp', (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
  }

  const storedOtp = otps[email];
  
  if (!storedOtp) {
      return res.status(400).json({ message: 'No OTP found for this email. Please request a new OTP.' });
  }

  if (storedOtp === otp) {
      delete otps[email]; // Remove OTP after successful validation
      return res.status(200).json({ message: 'OTP validated successfully' });
  } else {
      return res.status(400).json({ message: 'Invalid OTP' });
  }
});


router.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, mobileNumber } = req.body;

    if (!name || !email || !password || !mobileNumber) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 5 characters long."
      });
    }

    const checkEmailSQL = "SELECT * FROM users WHERE email = $1";
    const emailResult = await pool.query(checkEmailSQL, [email]);

    if (emailResult.rows.length > 0) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const checkNumberSQL = "SELECT * FROM users WHERE phonenumber = $1";
    const numberResult = await pool.query(checkNumberSQL, [mobileNumber]);

    if (numberResult.rows.length > 0) {
      return res.status(409).json({ message: "Mobile number already exists" });
    }

    const defaultImagePath = path.join(__dirname, '..', 'pfp', 'users', 'DefaultProfile.jpg');
    let userspfp = null;

    try {
      const imageBuffer = await fs.promises.readFile(defaultImagePath);
      userspfp = Buffer.from(imageBuffer);
    } catch (imageError) {
      userspfp = null;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertSQL = userspfp
      ? "INSERT INTO users (name, email, password, phonenumber, gender, userspfp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id"
      : "INSERT INTO users (name, email, password, phonenumber, gender) VALUES ($1, $2, $3, $4, $5) RETURNING id";
    const values = userspfp
      ? [name, email, hashedPassword, mobileNumber, "Not Set", userspfp]
      : [name, email, hashedPassword, mobileNumber, "Not Set"];
    const clientEmail = email;
    const titleEmail = "Welcome to AutoConnect!";
    const messageEmail = `Hello ${name},
    
    Welcome to AutoConnect Transport! We’re thrilled to have you on board.
    
    Start exploring our platform to find reliable car rental options tailored to your needs. If you have any questions, feel free to reach out—we’re here to help!
    
    Thank you for choosing AutoConnect Transport. Let’s get started on your journey!
    
    Best regards,  
    The AutoConnect Transport Team`;

    const result = await pool.query(insertSQL, values);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);
    
    return res.status(201).json({ message: "User registered successfully", user_id: result.rows[0].id });

  } catch (error) {
    return res.status(500).json({ message: "An unexpected error occurred", error: error.message });
  }
});


router.post('/api/client/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'No user found with this email' });
    }
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
    
    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
      [resetToken, tokenExpiry, email]
    );
    
    const frontendBaseUrl = (process.env.CLIENT_APP_URL || process.env.FRONTEND_URL || 'https://autoconnect-client-view.vercel.app').replace(/\/+$/, '');
    const resetLink = `${frontendBaseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const title = "Password Reset Request";
    const message = `
      <p>You have requested to reset your password.</p>
      <p>Please click the link below to reset your password:</p>
      <p><a href="${resetLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this reset, please ignore this email.</p>
    `;
    
    await sendEmailNotif(title, message, email);
    
    res.json({ message: 'Password reset instructions sent to your email' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});


router.post('/api/reset-password', async (req, res) => {
  const { token, resetToken, newPassword } = req.body;
  const providedToken = token || resetToken;

  if (!providedToken || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }
  
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()',
      [providedToken]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2',
      [hashedPassword, providedToken]
    );
    
    res.json({ message: 'Password successfully reset' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

  return router;
};
