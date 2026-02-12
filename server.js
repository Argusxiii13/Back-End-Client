// Import dependencies
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
// Initialize Express app
const app = express();
const PORT = 3001;
const crypto = require('crypto'); // To generate random OTP
const bcrypt = require('bcrypt');
// In-memory storage for OTPs (not persistent across server restarts)
const otps = {};
app.use(express.static(path.join(__dirname, 'admin')));

// Database connection (NEON_URL only)
const neonUrl = process.env.NEON_URL;
if (!neonUrl) {
  console.error('NEON_URL is required to start the server.');
  process.exit(1);
}
const pool = new Pool({ connectionString: neonUrl });


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

// Password validation function
const validatePassword = (password) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
  return regex.test(password);
};

// Example of a connection check
pool.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database. This is Client Side');
});

// Close the pool on app termination
process.on('SIGINT', () => {
  pool.end(() => {
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
});

// Middleware to send notif
const notifyAdmin = async (user_id, booking_id, title, message) => {
  const client = await pool.connect();
  try {
      await client.query(
          'INSERT INTO notifications_admin (user_id, booking_id, title, message) VALUES ($1, $2, $3, $4)',
          [user_id, booking_id, title, message]
      );
  } catch (error) {
      console.error('Error Sending Notif', error);
  } finally {
      client.release();
  }
};

const notifyClient = async (user_id, booking_id, title, message) => {
  const client = await pool.connect();
  try {
      await client.query(
          'INSERT INTO notifications_client (user_id, booking_id, title, message) VALUES ($1, $2, $3, $4)',
          [user_id, booking_id, title, message]
      );
  } catch (error) {
      console.error('Error Sending Notif', error);
  } finally {
      client.release();
  }
};

//===============================================================================================
//STRAY / LOST APIS
//===============================================================================================

app.post("/api/bookings", (req, res) => {
  
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
    console.log('Missing fields:', missingFields); // Log missing fields
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
      console.error('Database Error:', err); // Log the database error
      return res.status(500).json({ message: "Error creating booking", error: err.message });
    }

    const booking_id = result.rows[0].booking_id;
    console.log(booking_id);
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

    // Log successful query details
    console.log('Booking created successfully:', result.rows[0].booking_id);
    res.status(201).json({ message: "Booking created successfully", bookingId: result.rows[0].booking_id });
  });
});
// Mark notification as read
app.patch("/api/messages/:id/read", (req, res) => {
  const notificationId = req.params.id;


  // SQL query to update the 'read' status
  const sql = `
      UPDATE notifications_client
      SET read = $1
      WHERE m_id = $2
      RETURNING *;
  `;
  
  const params = [true, notificationId]; // Set read to true

  pool.query(sql, params, (err, results) => {
      if (err) {
          console.error('Error updating notification:', err);
          return res.status(500).json({ message: "Error marking notification as read", error: err.message });
      }

      if (results.rows.length === 0) {
          return res.status(404).json({ message: "Notification not found" });
      }

      const updatedNotification = results.rows[0];
      res.status(200).json({ message: "Notification marked as read", notification: updatedNotification });
  });
});

app.put('/api/messages/read', async (req, res) => {
  const { read } = req.body;
  if (typeof read !== 'boolean') {
      return res.status(400).json({ message: 'Invalid input' });
  }

  try {
      await pool.query('UPDATE messages SET read = $1 WHERE read = $2', [read, false]);
      res.json({ message: 'All notifications marked as read' });
  } catch (error) {
      console.error('Error marking notifications as read:', error);
      res.status(500).json({ message: 'Error marking notifications as read' });
  }
});

//===============================================================================================
//CLIENT REACT APIS
//===============================================================================================

// Update User Password
app.put('/api/profile/change-password/:id', async (req, res) => {
  const userId = req.params.id;
  const { currentPassword, newPassword } = req.body;

  // Check for required fields
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Current password and new password are required." });
  }

  // Validate new password
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ message: "New password must contain at least one uppercase letter, one lowercase letter, one number, and be at least 8 characters long." });
  }

  const client = await pool.connect();
  try {
    // Fetch user data
    const userResult = await client.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = userResult.rows[0];

    // Compare current password with stored password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update the password in the database
    await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, userId]);

    res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ message: "Error updating password", error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/messageconfirm', async (req, res) => {
  
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
      console.error("Error inserting message:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
});

app.post('/api/admin/notification', async (req, res) => {
  console.log("Received request:", req.body); // Log incoming request

  const { user_id, title, message } = req.body;

  // Validate required fields
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
      console.error("Error inserting admin notification:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/api/cars/fetching', async (req, res) => {
  try {
    const query = 'SELECT * FROM cars';
    const result = await pool.query(query);

    // Convert bytea to base64 string for each car
    const carsWithImages = result.rows.map(car => ({
      ...car,
      image: car.image ? car.image.toString('base64') : null
    }));

    res.json(carsWithImages);
  } catch (error) {
    console.error('Error fetching cars:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/cars/ratings', async (req, res) => {
  try {
    const sql = `
      SELECT car_id, AVG(rating) AS average_rating
      FROM feedback
      GROUP BY car_id;
    `;
    const result = await pool.query(sql);

    const ratings = {};
    result.rows.forEach(row => {
      ratings[row.car_id] = row.average_rating;
    });

    console.log('Retrieved car ratings:', ratings);

    res.json(ratings);
  } catch (error) {
    console.error('Error retrieving car ratings:', error);
    res.status(500).json({ message: 'Error retrieving car ratings' });
  }
});

// Assuming you're using Express and have your database connection set up
app.get('/api/cars/:id', async (req, res) => {
  const vehicleId = req.params.id;

  try {
    // Use a parameterized query to prevent SQL injection
    const query = 'SELECT * FROM cars_view WHERE id = $1';
    const result = await pool.query(query, [vehicleId]);

    // Check if the vehicle was found
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Convert bytea to base64 string for the vehicle
    const vehicle = {
      ...result.rows[0],
      image: result.rows[0].image ? result.rows[0].image.toString('base64') : null
    };

    res.json(vehicle);
  } catch (error) {
    console.error('Error fetching vehicle details:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});   
app.get('/api/carslider/data-retrieve', async (req, res) => {
  try {
    const sql = 'SELECT * FROM cars';
    const result = await pool.query(sql);

    const cars = result.rows.map(car => ({
      ...car,
      image: car.image ? Buffer.from(car.image).toString('base64') : null // Convert bytea to Base64
    }));

    res.json(cars);
  } catch (error) {
    console.error('Error retrieving cars:', error);
    res.status(500).json({ message: 'Error retrieving cars' });
  }
});

app.post("/api/send-email", sendEmailHandler);

app.post('/notify-client', async (req, res) => {
    const { title, message, clientEmail } = req.body;
    await sendEmailNotif(title, message, clientEmail);
    res.status(200).send('Notification sent');
});


app.get("/api/occupied-dates/:carId", (req, res) => {
  const carId = req.params.carId;
  const sql = `
    SELECT pickup_date, return_date 
    FROM bookings 
    WHERE car_id = $1 AND status = 'Confirmed'`; // Add condition for status

  pool.query(sql, [carId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Error fetching bookings", error: err.message });
    }

    const occupiedDates = results.rows.map(booking => ({
      startDate: booking.pickup_date,
      endDate: booking.return_date
    }));

    res.status(200).json(occupiedDates);
  });
});

app.post('/api/feedback/submit', async (req, res) => {
  console.log("Incoming request body:", req.body); // Log incoming request data

  const { user_id, car_id, booking_id, rating, description } = req.body;
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const formattedUserId = String(user_id).padStart(11, '0');

  // Validate incoming data
  if (!user_id) {
      console.error("Validation failed: User ID is required.");
      return res.status(400).json({ message: "User ID is required." });
  }
  if (!car_id) {
      console.error("Validation failed: Car ID is required.");
      return res.status(400).json({ message: "Car ID is required." });
  }
  if (rating === undefined || rating === null) {
      console.error("Validation failed: Rating is required.");
      return res.status(400).json({ message: "Rating is required." });
  }
  if (rating < 1 || rating > 5) {
      console.error("Validation failed: Rating must be between 1 and 5.");
      return res.status(400).json({ message: "Rating must be between 1 and 5." });
  }
  if (!description || description.trim() === '') {
      console.error("Validation failed: Description is required.");
      return res.status(400).json({ message: "Description is required." });
  }

  try {
      // Insert feedback into the database
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

      console.log("Feedback submitted successfully, ID:", feedbackId);
      res.status(201).json({ message: "Feedback submitted successfully.", feedbackId });
  } catch (error) {
      console.error("Error inserting feedback:", error);
      if (error.code === '23505') { // Unique violation
          return res.status(409).json({ message: "Feedback already submitted for this user and car." });
      }
      res.status(500).json({ message: "Internal server error. Please try again later." });
  }
});

app.get("/api/messages/user/:user_id", (req, res) => {
  const user_id = parseInt(req.params.user_id, 10); 
  const sql = "SELECT * FROM notifications_client WHERE user_id = $1 ORDER BY created_at DESC"; 

  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error("Database query error:", err); // Log the error for debugging
      return res.status(500).json({ message: "Error fetching messages", error: err.message });
    }

    if (results.rows.length === 0) {
      
      return res.status(200).json([]); // Return an empty array instead of 404
    }
    res.status(200).json(results.rows); // Return the messages
  });
});

app.get("/api/bookings/user/:id", (req, res) => {
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
      console.error(err);
      return res.status(500).json({ message: "Error fetching bookings", error: err.message });
    }

    res.json(results.rows);
  });
});

app.put('/api/bookings/cancel/:booking_id', async (req, res) => {
  const { booking_id } = req.params;
  const { cancel_reason, user_id, clientEmail } = req.body; // Extract the cancel reason from the request body
  const formattedBookingId = String(booking_id).padStart(11, '0');
  const formattedUserId = String(user_id).padStart(11, '0');
  // Log incoming request for debugging
  console.log(`Received cancel request for booking ID: ${booking_id}`);
  console.log(`Cancel reason: ${cancel_reason}`);

  // Validate the booking_id and cancel_reason
  if (!booking_id) {
    console.error('Booking ID is required.');
    return res.status(400).json({ message: 'Booking ID is required.' });
  }
  if (!cancel_reason) {
    console.error('Cancellation reason is required.');
    return res.status(400).json({ message: 'Cancellation reason is required.' });
  }

  try {
    // Fetch the booking details to get pickup_date and price
    const bookingResult = await pool.query(
      `SELECT pickup_date, price FROM bookings WHERE booking_id = $1`,
      [booking_id]
    );

    // Check if the booking was found
    if (bookingResult.rowCount === 0) {
      console.warn(`No booking found for ID: ${booking_id}`);
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const { pickup_date, price } = bookingResult.rows[0];
    const cancel_date = new Date(); // Get the current date
    const daysBeforePickup = (new Date(pickup_date) - cancel_date) / (1000 * 60 * 60 * 24); // Calculate difference in days

    // Determine the cancellation fee based on the policy
    let cancel_fee = 0;
    if (daysBeforePickup < 0) {
      // Cancellation on the rental day or no-show
      cancel_fee = price; // 100% fee
    } else if (daysBeforePickup < 1) {
      // Cancellation one day before the rental date
      cancel_fee = price * 0.50; // 50% fee
    } else if (daysBeforePickup < 7) {
      // Cancellations less than 7 days before the rental date
      cancel_fee = price * 0.20; // 20% fee
    }

    // Update the booking status to 'Cancelled', set the cancellation reason, cancel date, and cancel fee
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

    // Respond with success
    res.status(200).json({ message: 'Booking cancelled successfully.', booking: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'An error occurred while cancelling the booking.' });
  }
});

app.get("/api/bookings/:bookingId", (req, res) => {
  const bookingId = req.params.bookingId;

  const sql = `
    SELECT bookings.*, cars.id AS car_id, cars.brand, cars.model 
    FROM bookings 
    LEFT JOIN cars ON bookings.car_id = cars.id 
    WHERE bookings.booking_id = $1
  `;

  pool.query(sql, [bookingId], (err, results) => {
    if (err) {
      console.error('Error fetching booking details:', err);
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
    
    // Log the fetched booking data

    res.json(results.rows[0]);
  });
  
});

app.get("/api/user/:id", (req, res) => {
  const user_id = req.params.id;
  const sql = "SELECT * FROM users WHERE id = $1"; // Use $1 for parameterized queries

  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error(err);
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

app.put('/api/bookings/:bookingId/confirm-price', async (req, res) => {
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
      console.log('Executing query:', query, 'with parameters:', [id]);
      
      const result = await pool.query(query, [id]);

      if (result.rowCount === 0) {
          console.error('No booking found with ID:', id);
          return res.status(404).json({ error: 'Booking not found' });
      }
      
      notifyClient(user_id, booking_id, titleClient, messageClient);
      notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      res.status(200).json({ message: 'Price accepted successfully' });
  } catch (error) {
      console.error('Error updating price acceptance:', error);
      res.status(500).json({ error: 'Failed to update price acceptance' });
  }
});

app.get('/api/booking/data-retrieve/:booking_id', async (req, res) => {
  const bookingId = req.params.booking_id;
  
  try {
    const result = await pool.query("SELECT * FROM bookings WHERE booking_id = $1", [bookingId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ message: 'Error retrieving booking', error: error.message });
  }
});

app.get('/api/bookings/:booking_id', async (req, res) => {
  const { booking_id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];
    res.json({
      booking_id: booking.booking_id,
      pickup_location: booking.pickup_location,
      return_location: booking.return_location,
      pickup_date: booking.pickup_date,
      return_date: booking.return_date,
      pickup_time: booking.pickup_time,
      return_time: booking.return_time,
      user_id: booking.user_id,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      rental_type: booking.rental_type,
      car_id: booking.car_id,
      status: booking.status,
      created_at: booking.created_at,
      priceaccepted: booking.priceaccepted,
      price: booking.price,
    });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/upload-receipt/:bookingId', upload.single('receipt'), async (req, res) => {
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

    // Update the bookings table with the uploaded receipt
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
    console.error('Error uploading receipt:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profile/update/:id', upload.single('userspfp'), async (req, res) => {
  const user_id = req.params.id;
  const { name, phonenumber, gender } = req.body;
  let userspfp = null;

  // Check if a file was uploaded and convert it to base64
  if (req.file) {
      try {
          // Convert the uploaded file buffer to base64
          userspfp = req.file.buffer.toString('base64');
      } catch (error) {
          console.error('Error converting file to base64:', error);
          return res.status(500).json({ message: 'Error processing image', error: error.message });
      }
  }

  // Construct the SQL query to update the user
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
      console.log('SQL Query:', sql);
      console.log('Values:', values);

      const result = await pool.query(sql, values);
      if (result.rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json(result.rows[0]);
  } catch (error) {
      console.error('Error updating user profile:', error);
      return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post("/api/signin", async (req, res) => {
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

    // Compare the provided password with the stored hash
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    delete user.password; // Don't expose password

    res.status(200).json({ message: "Signin successful", user });
    
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error during signin", error: err.message });
  }
});


app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ message: 'Email is required' });
  }

  try {
      // Check if the email exists in the users table
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

      if (result.rows.length > 0) {
          // Email already registered
          return res.status(400).json({ message: 'Email is already registered.' });
      }

      // Generate OTP
      const otp = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
      otps[email] = otp; // Store OTP in memory

      // Set up Nodemailer
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
      console.log('Sending email to:', email);

      // Email options
      const mailOptions = {
          from: process.env.SMTP_USER,
          to: email,
          subject: 'Your OTP Code',
          text: `Your OTP is: ${otp}. Please use this OTP to proceed with your action.`,
      };

      // Send the email
      await transporter.sendMail(mailOptions);
      console.log('OTP sent successfully');

      return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/validate-otp', (req, res) => {
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

app.get("/api/cars", (req, res) => {
  const sql = "SELECT * FROM cars";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Error fetching cars", error: err.message });
    }
    res.json(results.rows);
  });
});

app.post("/api/signup", async (req, res) => {
  console.log('Incoming request body:', req.body); // Log the incoming request body

  try {
    const { name, email, password, mobileNumber } = req.body;

    // Validate input
    if (!name || !email || !password || !mobileNumber) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and be at least 8 characters long."
      });
    }

    // Check for existing email
    const checkEmailSQL = "SELECT * FROM users WHERE email = $1";
    const emailResult = await pool.query(checkEmailSQL, [email]);

    if (emailResult.rows.length > 0) {
      return res.status(409).json({ message: "Email already exists" });
    }

    // Check for existing mobile number
    const checkNumberSQL = "SELECT * FROM users WHERE phonenumber = $1";
    const numberResult = await pool.query(checkNumberSQL, [mobileNumber]);

    if (numberResult.rows.length > 0) {
      return res.status(409).json({ message: "Mobile number already exists" });
    }

    // Read the default profile picture
    const defaultImagePath = path.join(__dirname, 'pfp', 'users', 'DefaultProfile.jpg');
    const imageBuffer = await fs.promises.readFile(defaultImagePath);
    const userspfp = Buffer.from(imageBuffer);

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into the database
    const insertSQL = "INSERT INTO users (name, email, password, phonenumber, gender, userspfp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id";
    const values = [name, email, hashedPassword, mobileNumber, "Not Set", userspfp];
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
    console.error('Unexpected error:', error);
    return res.status(500).json({ message: "An unexpected error occurred", error: error.message });
  }
});

// Fetch User Profile Picture
app.get('/api/profilepicture/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // Query to get the user profile picture
    const result = await pool.query('SELECT userspfp FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userProfilePicture = result.rows[0].userspfp;

    // Set response headers for image
    res.set('Content-Type', 'image/jpeg');
    res.send(userProfilePicture);
  } catch (error) {
    console.error('Error fetching profile picture:', error);
    res.status(500).json({ message: "Error fetching profile picture", error: error.message });
  }
});

app.get('/api/feedback/check/:bookingId', async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
      return res.status(400).json({ message: "Missing booking ID" });
  }

  try {
      // Query to check if feedback exists for the given booking ID
      const result = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM feedback WHERE booking_id = $1) AS hasFeedback`,
          [bookingId]
      );

      // Send the feedback status as response
      return res.status(200).json({ hasFeedback: result.rows[0].hasfeedback });
  } catch (error) {
      console.error("Error checking feedback status:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
});

app.put('/api/booking/update/:bookingId', async (req, res) => {
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
      console.log(user_id);
      notifyClient(user_id, booking_id, titleClient, messageClient);
      notifyAdmin(user_id, booking_id, titleAdmin, messageAdmin);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      res.json(updatedBooking);
  } catch (error) {
      console.error('Error updating booking:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate reset token and send email
app.post('/api/client/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    // Check if user exists
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'No user found with this email' });
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
    
    // Store token in database
    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
      [resetToken, tokenExpiry, email]
    );
    
    // Prepare email content
    const resetLink = `https://autoconnect-transport.vercel.app/reset-password?token=${resetToken}`;
    const title = "Password Reset Request";
    const message = `
      <p>You have requested to reset your password.</p>
      <p>Please click the link below to reset your password:</p>
      <p><a href="${resetLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this reset, please ignore this email.</p>
    `;
    
    // Send email using your existing function
    await sendEmailNotif(title, message, email);
    
    res.json({ message: 'Password reset instructions sent to your email' });
  } catch (error) {
    console.error('Error in forgot password:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});
// Reset password endpoint
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  try {
    // Find user with valid token
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()',
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password and clear reset token
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2',
      [hashedPassword, token]
    );
    
    res.json({ message: 'Password successfully reset' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});


