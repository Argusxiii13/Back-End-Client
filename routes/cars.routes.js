const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/cars/fetching', async (req, res) => {
  try {
    const query = 'SELECT * FROM cars';
    const result = await pool.query(query);

    const carsWithImages = result.rows.map(car => ({
      ...car,
      image: car.image ? car.image.toString('base64') : null
    }));

    res.json(carsWithImages);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});


router.get('/api/cars/ratings', async (req, res) => {
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

    res.json(ratings);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving car ratings' });
  }
});


router.get('/api/cars/:id', async (req, res) => {
  const vehicleId = req.params.id;

  try {
    const query = 'SELECT * FROM cars_view WHERE id = $1';
    const result = await pool.query(query, [vehicleId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const vehicle = {
      ...result.rows[0],
      image: result.rows[0].image ? result.rows[0].image.toString('base64') : null
    };

    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});
   

router.get('/api/carslider/data-retrieve', async (req, res) => {
  try {
    const sql = 'SELECT * FROM cars';
    const result = await pool.query(sql);

    const cars = result.rows.map(car => ({
      ...car,
      image: car.image ? Buffer.from(car.image).toString('base64') : null // Convert bytea to Base64
    }));

    res.json(cars);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving cars' });
  }
});


router.get("/api/cars", (req, res) => {
  const sql = "SELECT * FROM cars";
  pool.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching cars", error: err.message });
    }
    res.json(results.rows);
  });
});

  return router;
};
