const jwt = require("jsonwebtoken");
const { isValidId } = require("../utils/validation");

function authenticate(req, res, next) {
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

    // Validate user ID in JWT payload
    if (!isValidId(decoded.id)) {
      return res.status(401).json({
        error: "Invalid token",
      });
    }

    // Alex's task middleware expects req.user.id
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
