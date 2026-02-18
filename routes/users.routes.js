const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get("/api/user/:id", (req, res) => {
  const user_id = req.params.id;
  const sql = "SELECT * FROM users WHERE id = $1"; // Use $1 for parameterized queries

  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching user data", error: err.message });
    }

    if (results.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = results.rows[0];
    delete user.password; 
    res.status(200).json(user);
  });
});

  return router;
};
