const authRoutes = require('./auth.routes');
const bookingsRoutes = require('./bookings.routes');
const carsRoutes = require('./cars.routes');
const feedbackRoutes = require('./feedback.routes');
const messagesRoutes = require('./messages.routes');
const notificationsRoutes = require('./notifications.routes');
const profileRoutes = require('./profile.routes');
const usersRoutes = require('./users.routes');

module.exports = (app, deps) => {
  app.use(authRoutes(deps));
  app.use(bookingsRoutes(deps));
  app.use(carsRoutes(deps));
  app.use(feedbackRoutes(deps));
  app.use(messagesRoutes(deps));
  app.use(notificationsRoutes(deps));
  app.use(profileRoutes(deps));
  app.use(usersRoutes(deps));
};
