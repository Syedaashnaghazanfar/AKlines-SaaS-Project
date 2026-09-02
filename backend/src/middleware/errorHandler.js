const { AppError } = require('../utils/errors');

// Centralized error handler. Never leaks internals (stack traces, DB errors) to clients.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
  }

  if (err.code === 'P2002') {
    // Prisma unique constraint violation
    return res.status(409).json({ error: 'A record with these details already exists' });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
