const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.post('/api/messageconfirm', async (req, res) => {
  
  const { user_id, booking_id, title, message } = req.body;

  if (!user_id || !title || !message) {
      return res.status(400).json({ message: "Missing required fields" });
  }

  try {
      const result = await pool.query(
          `INSERT INTO notifications_client (user_id, booking_id, title, message) 
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [user_id, booking_id, title, message]
      );
      return res.status(201).json({ message: "Message sent successfully", data: result.rows[0] });
  } catch (error) {
      return res.status(500).json({ message: "Internal server error" });
  }
});


router.post('/api/admin/notification', async (req, res) => {
  const { user_id, title, message } = req.body;

  if (!user_id || !title || !message) {
      return res.status(400).json({ message: "Missing required fields" });
  }

  try {
      const result = await pool.query(
          `INSERT INTO adminnotification (user_id, title, message, read, created_at) 
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [user_id, title, message, false, new Date()] // 'read' is false by default
      );
      return res.status(201).json({ message: "Admin notification sent successfully", data: result.rows[0] });
  } catch (error) {
      return res.status(500).json({ message: "Internal server error" });
  }
});


router.post("/api/send-email", sendEmailHandler);


router.post('/notify-client', async (req, res) => {
    const { title, message, clientEmail } = req.body;
    await sendEmailNotif(title, message, clientEmail);
    res.status(200).send('Notification sent');
});

  return router;
};
