
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { isValidId } = require("../utils/validation");

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required",
    });
  }

  const token = authorization.slice(7);

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT secret is not configured");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Validate the user ID inside the token
    if (!isValidId(decoded.id)) {
      return res.status(401).json({
        error: "Invalid token",
      });
    }

    // Confirm the user still exists in PostgreSQL
    const result = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "User account no longer exists",
      });
    }

    // Make the user ID available to protected routes
    req.user = {
      id: decoded.id,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        error: "Invalid or expired token",
      });
    }

    next(error);
  }
}

module.exports = authenticate;
