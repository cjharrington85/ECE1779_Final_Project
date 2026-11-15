const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");

const router = express.Router();

// Register a new user
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    // Validate user input
    if (
      typeof username !== "string" ||
      !username.trim() ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Valid username, email, and password of at least 8 characters are required",
      });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanUsername.length > 100 || cleanEmail.length > 254) {
      return res.status(400).json({ error: "Username or email is too long" });
    }

    // Never store the original password
    const passwordHash = await bcrypt.hash(password, 12);

    // Save the new user to PostgreSQL
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [cleanUsername, cleanEmail, passwordHash],
    );

    return res.status(201).json({
      user: result.rows[0],
    });
  } catch (error) {
    // PostgreSQL unique constraint violation
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Username or email already exists",
      });
    }

    console.error("Registration failed:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

const jwt = require("jsonwebtoken");

// Login an existing user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE lower(email) = lower($1)`,
      [email.trim()],
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Invalid email or password",
      });
    }

    if (
      !process.env.JWT_SECRET ||
      process.env.JWT_SECRET ===
        "replace-with-a-long-random-secret-before-testing-login"
    ) {
      return res.status(500).json({
        error: "Authentication is not configured",
      });
    }

    const token = jwt.sign({ id: String(user.id) }, process.env.JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

module.exports = router;
