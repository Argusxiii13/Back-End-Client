const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.post('/api/feedback/submit', async (req, res) => {
  const { user_id, car_id, booking_id, rating, description } = req.body;
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const formattedUserId = String(user_id).padStart(11, '0');

  if (!user_id) {
      return res.status(400).json({ message: "User ID is required." });
  }
  if (!car_id) {
      return res.status(400).json({ message: "Car ID is required." });
  }
  if (rating === undefined || rating === null) {
      return res.status(400).json({ message: "Rating is required." });
  }
  if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5." });
  }
  if (!description || description.trim() === '') {
      return res.status(400).json({ message: "Description is required." });
  }

  try {
      const sql = `
          INSERT INTO public.feedback (user_id, car_id, booking_id, rating, description)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING f_id;
      `;
      const values = [user_id, car_id, booking_id, rating, description];

      const result = await pool.query(sql, values);
      const feedbackId = result.rows[0].f_id;

      const titleClient = "Feedback Submitted.";
      const messageClient = `Your feedback for Booking:${formattedBookingId} has been received, thanks again for choosing us !`;
      const titleAdmin = "Feedback Received.";
      const messageAdmin = `Booking:${formattedBookingId} left a feedback.`

      notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
      notifyClient(user_id, booking_id, titleClient, messageClient);
      res.status(201).json({ message: "Feedback submitted successfully.", feedbackId });
  } catch (error) {
      if (error.code === '23505') { // Unique violation
          return res.status(409).json({ message: "Feedback already submitted for this user and car." });
      }
      res.status(500).json({ message: "Internal server error. Please try again later." });
  }
});


router.get('/api/feedback/check/:bookingId', async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
      return res.status(400).json({ message: "Missing booking ID" });
  }

  try {
      const result = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM feedback WHERE booking_id = $1) AS hasFeedback`,
          [bookingId]
      );

      return res.status(200).json({ hasFeedback: result.rows[0].hasfeedback });
  } catch (error) {
      return res.status(500).json({ message: "Internal server error" });
  }
});

  return router;
};
