const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config/env');

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function verifyToken(token) {
  // Pin the algorithm explicitly - defense-in-depth against algorithm-confusion
  // attacks even though this app only ever signs with an HMAC secret.
  return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };
