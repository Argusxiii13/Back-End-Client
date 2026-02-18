const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.patch("/api/messages/:id/read", (req, res) => {
  const notificationId = req.params.id;


  const sql = `
      UPDATE notifications_client
      SET read = $1
      WHERE m_id = $2
      RETURNING *;
  `;
  
  const params = [true, notificationId]; // Set read to true

  pool.query(sql, params, (err, results) => {
      if (err) {
          return res.status(500).json({ message: "Error marking notification as read", error: err.message });
      }

      if (results.rows.length === 0) {
          return res.status(404).json({ message: "Notification not found" });
      }

      const updatedNotification = results.rows[0];
      res.status(200).json({ message: "Notification marked as read", notification: updatedNotification });
  });
});


router.put('/api/messages/read', async (req, res) => {
  const { read } = req.body;
  if (typeof read !== 'boolean') {
      return res.status(400).json({ message: 'Invalid input' });
  }

  try {
      await pool.query('UPDATE messages SET read = $1 WHERE read = $2', [read, false]);
      res.json({ message: 'All notifications marked as read' });
  } catch (error) {
      res.status(500).json({ message: 'Error marking notifications as read' });
  }
});


router.get("/api/messages/user/:user_id", (req, res) => {
  const user_id = parseInt(req.params.user_id, 10); 
  const sql = "SELECT * FROM notifications_client WHERE user_id = $1 ORDER BY created_at DESC"; 

  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching messages", error: err.message });
    }

    if (results.rows.length === 0) {
      
      return res.status(200).json([]); // Return an empty array instead of 404
    }
    res.status(200).json(results.rows); // Return the messages
  });
});

  return router;
};
