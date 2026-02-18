const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.use((req, res, next) => {
  if (req.url.startsWith('/api/bookings/data-retrieve/')) {
    req.url = req.url.replace('/api/bookings/data-retrieve/', '/api/booking/data-retrieve/');
  }

  if (req.url.startsWith('/api/bookings/update/')) {
    req.url = req.url.replace('/api/bookings/update/', '/api/booking/update/');
  }

  next();
});

router.post("/api/bookings", (req, res) => {
  
  const { 
    pickupLocation, returnLocation, pickupDate, returnDate, 
    pickupTime, returnTime, user_id, name, email, phone, 
    rentalType, carId, additionalrequest
  } = req.body;
  const formattedUserId = String(user_id).padStart(11, '0'); // Ensure booking_id is 11 characters long
  
  
  const requiredFields = [
    'pickupLocation', 'returnLocation', 'pickupDate', 'returnDate',
    'pickupTime', 'returnTime', 'user_id', 'name', 'email', 'phone', 
    'rentalType', 'carId', 'additionalrequest'
  ];

  const missingFields = requiredFields.filter(field => !req.body[field]);

  if (missingFields.length > 0) {
    return res.status(400).json({ 
      message: "Missing required fields", 
      missingFields: missingFields 
    });
  }

  const sql = `
    INSERT INTO bookings 
    (pickup_location, return_location, pickup_date, return_date, 
     pickup_time, return_time, user_id, name, email, phone, 
     rental_type, car_id, additionalrequest) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
    RETURNING booking_id
  `;

  const values = [
    pickupLocation, returnLocation, pickupDate, returnDate,
    pickupTime, returnTime, user_id, name, email, phone,
    rentalType, carId, additionalrequest
  ];

  pool.query(sql, values, (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Error creating booking", error: err.message });
    }

    const booking_id = result.rows[0].booking_id;
    const formattedUserId = String(user_id).padStart(11, '0'); 
    const formattedBookingId = String(booking_id).padStart(11, '0'); 
    const titleClient = "Booking Created.";
    const messageClient = `Your Booking:${formattedBookingId} has been created and is now Pending. Please wait for the price to be finalized.`;
    const titleAdmin = "Client Made Booking";
    const messageAdmin = `User:${formattedUserId} named ${name} has made Booking:${formattedBookingId}.`;
    const titleEmail = "Booking Confirmation: Pending Approval";
    const messageEmail = `Hello,
    
    Thank you for booking with AutoConnect Transport! 
    
    We’re excited to let you know that your booking (ID: ${formattedBookingId}) has been successfully created. It is currently marked as **Pending** while we finalize the pricing details. 
    
    Please stay tuned for an update once the process is complete. If you have any questions in the meantime, don’t hesitate to reach out to us. 
    
    Thank you for choosing AutoConnect Transport. We look forward to serving you!
    
    Best regards,  
    The AutoConnect Transport Team`;
    const clientEmail = email;

    notifyClient(user_id, booking_id, titleClient, messageClient);
    notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);

    res.status(201).json({ message: "Booking created successfully", bookingId: result.rows[0].booking_id });
  });
});


router.get("/api/occupied-dates/:carId", (req, res) => {
  const carId = req.params.carId;
  const sql = `
    SELECT pickup_date, return_date 
    FROM bookings 
    WHERE car_id = $1 AND status = 'Confirmed'`; // Add condition for status

  pool.query(sql, [carId], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching bookings", error: err.message });
    }

    const occupiedDates = results.rows.map(booking => ({
      startDate: booking.pickup_date,
      endDate: booking.return_date
    }));

    res.status(200).json(occupiedDates);
  });
});


router.get("/api/bookings/user/:id", (req, res) => {
  const user_id = req.params.id;

  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  const sql = `
    SELECT b.*, c.brand, c.model 
    FROM bookings b
    JOIN cars c ON b.car_id = c.id 
    WHERE b.user_id = $1 
    ORDER BY b.created_at DESC
  `;

  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching bookings", error: err.message });
    }

    res.json(results.rows);
  });
});


router.put('/api/bookings/cancel/:booking_id', async (req, res) => {
  const { booking_id } = req.params;
  const { cancel_reason, user_id, clientEmail } = req.body; // Extract the cancel reason from the request body
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const formattedUserId = String(user_id).padStart(11, '0');

  if (!booking_id) {
    return res.status(400).json({ message: 'Booking ID is required.' });
  }
  if (!cancel_reason) {
    return res.status(400).json({ message: 'Cancellation reason is required.' });
  }

  try {
    const bookingResult = await pool.query(
      `SELECT pickup_date, price FROM bookings WHERE booking_id = $1`,
      [booking_id]
    );

    if (bookingResult.rowCount === 0) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const { pickup_date, price } = bookingResult.rows[0];
    const cancel_date = new Date(); // Get the current date
    const daysBeforePickup = (new Date(pickup_date) - cancel_date) / (1000 * 60 * 60 * 24); // Calculate difference in days

    let cancel_fee = 0;
    if (daysBeforePickup < 0) {
      cancel_fee = price; // 100% fee
    } else if (daysBeforePickup < 1) {
      cancel_fee = price * 0.50; // 50% fee
    } else if (daysBeforePickup < 7) {
      cancel_fee = price * 0.20; // 20% fee
    }

    const result = await pool.query(
      `UPDATE bookings SET status = $1, cancel_reason = $2, cancel_date = CURRENT_DATE, cancel_fee = $3 WHERE booking_id = $4 RETURNING *`,
      ['Cancelled', cancel_reason, cancel_fee, booking_id]
    );

    const titleAdmin = "Client Cancelled Booking.";
    const messageAdmin = `Booking:${formattedBookingId} has been cancelled by a client.`;
    const titleClient = "Succesfully Cancelled Booking.";
    const messageClient = `You have succesfully cancelled Booking:${formattedBookingId}.`
    const titleEmail = "Booking Cancellation Confirmation";
    const messageEmail = `Hello,
    
    We’re writing to confirm that your booking (ID: ${formattedBookingId}) has been successfully cancelled as per your request.
    
    If this cancellation was made in error or if you have any further questions, please don't hesitate to contact us. We're here to assist you.
    
    Thank you for considering AutoConnect Transport, and we hope to serve you again in the future.
    
    Best regards,  
    The AutoConnect Transport Team`;
    
    notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
    notifyClient(user_id, booking_id, titleClient, messageClient);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);

    res.status(200).json({ message: 'Booking cancelled successfully.', booking: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'An error occurred while cancelling the booking.' });
  }
});


router.get("/api/bookings/:bookingId", (req, res) => {
  const bookingId = req.params.bookingId;

  const sql = `
    SELECT bookings.*, cars.id AS car_id, cars.brand, cars.model 
    FROM bookings 
    LEFT JOIN cars ON bookings.car_id = cars.id 
    WHERE bookings.booking_id = $1
  `;

  pool.query(sql, [bookingId], (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: "Error fetching booking details", 
        error: err.message 
      });
    }

    if (results.rows.length === 0) {
      return res.status(404).json({ 
        message: "Booking not found" 
      });
    }
    

    res.json(results.rows[0]);
  });
  
});


router.put('/api/bookings/:bookingId/confirm-price', async (req, res) => {
  const { booking_id, user_id, clientEmail } = req.body;
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const formattedUserId = String(user_id).padStart(11, '0');
  const titleClient = "Payment Method.";
  const messageClient = `Reminder: Your Booking:${formattedBookingId} will be declined if not paid within 24 hours.`;
  const titleAdmin = 'Price Accepted.';
  const messageAdmin = `Booking:${formattedBookingId} has its price accepted.`;
  const titleEmail = "Price Accepted: Payment Required";
  const messageEmail = `Hello,
  
  You have successfully accepted the designated price for your booking (ID: ${formattedBookingId}). Please note that the booking will be automatically declined if payment is not made within 24 hours.
  
  To complete your booking, please proceed to the website and settle the payment at your earliest convenience.
  
  Thank you for choosing AutoConnect Transport!
  
  Best regards,  
  The AutoConnect Transport Team`;
  try {
      const id = parseInt(booking_id, 10);
      const query = 'UPDATE bookings SET priceaccepted = true WHERE booking_id = $1';

      const result = await pool.query(query, [id]);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Booking not found' });
      }
      
      notifyClient(user_id, booking_id, titleClient, messageClient);
      notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      res.status(200).json({ message: 'Price accepted successfully' });
  } catch (error) {
      res.status(500).json({ error: 'Failed to update price acceptance' });
  }
});


router.get('/api/booking/data-retrieve/:booking_id', async (req, res) => {
  const bookingId = req.params.booking_id;
  
  try {
    const result = await pool.query("SELECT * FROM bookings WHERE booking_id = $1", [bookingId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving booking', error: error.message });
  }
});


router.put('/api/upload-receipt/:bookingId', upload.single('receipt'), async (req, res) => {
  const bookingId = req.params.bookingId;
  const receipt = req.file; // The uploaded file
  const {user_id, booking_id, clientEmail} = req.body;
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const titleClient = "Proof of Payment Submitted.";
  const messageClient = `Success: Your Proof of Payment for Booking:${formattedBookingId} has been successfully submitted. Please wait for further notice.`;
  const titleAdmin = "Proof of Payment Received";
  const messageAdmin = `Booking:${formattedBookingId} has its Proof of Payment submitted.`;
  const titleEmail = "Proof of Payment Submitted";
  const messageEmail = `Hello,
  
  Thank you for submitting your proof of payment for Booking ID: ${formattedBookingId}. 
  
  Your submission has been received successfully. Please allow some time for verification. We will notify you once the payment has been confirmed.
  
  If you have any questions, feel free to reach out to us. Thank you for choosing AutoConnect Transport!
  
  Best regards,  
  The AutoConnect Transport Team`;


  if (!receipt) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const fileBuffer = receipt.buffer;

    const query = `
      UPDATE bookings
      SET receipt = $1
      WHERE booking_id = $2
    `;
    const values = [fileBuffer, bookingId];

    const result = await pool.query(query, values);

    notifyClient(user_id, booking_id, titleClient, messageClient);
    notifyAdmin( user_id,booking_id, titleAdmin, messageAdmin);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);

    return res.status(200).json({ message: 'Receipt uploaded successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/api/booking/update/:bookingId', async (req, res) => {
  const booking_id = req.params.bookingId;
  const {
    car_id,
    name,
    email,
    phone,
    pickup_location,
    pickup_date,
    pickup_time,
    return_location,
    return_date,
    return_time,
    rental_type,
    additionalrequest,
    user_id
} = req.body;
  const formattedUserId = String(user_id).padStart(11, '0');
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const titleAdmin = "Client Updated Booking.";
  const messageAdmin = `Booking:${formattedBookingId} has its detailed updated by its user, please review it.`;
  const titleClient = "Booking Updated.";
  const messageClient = `Booking:${formattedBookingId} has been updated succesfully. Please wait for response.`;
  const titleEmail = "Booking Update Confirmation";
  const messageEmail = `Hello,
  
  We’re writing to let you know that your booking (ID: ${formattedBookingId}) has been successfully updated. 
  
  Our team is currently reviewing the changes, and we will notify you once the evaluation is complete. If you have any questions or need further assistance, please feel free to reach out.
  
  Thank you for choosing AutoConnect Transport!
  
  Best regards,  
  The AutoConnect Transport Team`;
  
  const clientEmail = email;

  try {
      const query = `
          UPDATE bookings
          SET
              car_id = $1,
              name = $2,
              email = $3,
              phone = $4,
              pickup_location = $5,
              pickup_date = $6,
              pickup_time = $7,
              return_location = $8,
              return_date = $9,
              return_time = $10,
              rental_type = $11,
              additionalrequest = $12
          WHERE booking_id = $13
          RETURNING *;
      `;

      const values = [
          car_id,
          name,
          email,
          phone,
          pickup_location,
          pickup_date,
          pickup_time,
          return_location,
          return_date,
          return_time,
          rental_type,
          additionalrequest,
          booking_id
      ];

      const result = await pool.query(query, values);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Booking not found' });
      }

      const updatedBooking = result.rows[0];
      notifyClient(user_id, booking_id, titleClient, messageClient);
      notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      res.json(updatedBooking);
  } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
  }
});


  return router;
};
