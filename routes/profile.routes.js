const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.put('/api/profile/change-password/:id', async (req, res) => {
  const userId = req.params.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Current password and new password are required." });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({ message: "New password must contain at least one uppercase letter, one lowercase letter, one number, and be at least 8 characters long." });
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = userResult.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, userId]);

    res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    res.status(500).json({ message: "Error updating password", error: error.message });
  } finally {
    client.release();
  }
});


router.put('/api/profile/update/:id', upload.single('userspfp'), async (req, res) => {
  const user_id = req.params.id;
  const { name, phonenumber, gender } = req.body;
  let userspfp = null;

  if (req.file) {
      try {
          userspfp = req.file.buffer.toString('base64');
      } catch (error) {
          return res.status(500).json({ message: 'Error processing image', error: error.message });
      }
  }

  const sql = `
      UPDATE users
      SET 
          name = $1,
          phonenumber = $2,
          gender = $3,
          userspfp = COALESCE(decode($4, 'base64'), userspfp)  -- Only update if a new picture is provided
      WHERE id = $5
      RETURNING *;
  `;

  const values = [
      name,
      phonenumber,
      gender,
      userspfp, // This will be the base64 string
      user_id
  ];

  try {
      const result = await pool.query(sql, values);
      if (result.rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json(result.rows[0]);
  } catch (error) {
      return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});


router.post('/api/profile/upload-picture/:id', upload.single('userspfp'), async (req, res) => {
  const userId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ message: 'Profile picture file is required' });
  }

  let userspfp;
  try {
    userspfp = req.file.buffer.toString('base64');
  } catch (error) {
    return res.status(500).json({ message: 'Error processing image', error: error.message });
  }

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET userspfp = decode($1, 'base64')
      WHERE id = $2
      RETURNING id;
      `,
      [userspfp, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ message: 'Profile picture updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});


router.get('/api/profilepicture/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query('SELECT userspfp FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userProfilePicture = result.rows[0].userspfp;

    res.set('Content-Type', 'image/jpeg');
    res.send(userProfilePicture);
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile picture", error: error.message });
  }
});

  return router;
};
