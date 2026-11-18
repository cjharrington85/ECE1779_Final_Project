
const express = require("express");
const pool = require("../db");

const router = express.Router();

// Get logged-in user's profile
router.get("/me", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    return res.status(200).json({
      user: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Update logged-in user's profile
router.patch("/me", async (req, res, next) => {
  try {
    const { username, email } = req.body || {};

    if (username === undefined && email === undefined) {
      return res.status(400).json({
        error: "Provide a username or email to update"
      });
    }

    if (
      (username !== undefined &&
        (typeof username !== "string" ||
          !username.trim() ||
          username.trim().length > 100)) ||
      (email !== undefined &&
        (typeof email !== "string" ||
          email.trim().length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))
    ) {
      return res.status(400).json({
        error: "Invalid username or email"
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET username = COALESCE($1, username),
           email = COALESCE($2, email)
       WHERE id = $3
       RETURNING id, username, email, created_at`,
      [
        username === undefined ? null : username.trim(),
        email === undefined ? null : email.trim().toLowerCase(),
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    return res.status(200).json({
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Username or email already exists"
      });
    }

    next(error);
  }
});

// Delete logged-in user's account
router.delete("/me", async (req, res, next) => {
  try {
    // Prevent admins from deleting accounts while managing teams
    const result = await pool.query(
      `DELETE FROM users
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM team_members
           WHERE user_id = $1
             AND role = 'admin'
         )
       RETURNING id, username, email`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      const adminCheck = await pool.query(
        `SELECT 1
         FROM team_members
         WHERE user_id = $1
           AND role = 'admin'
         LIMIT 1`,
        [req.user.id]
      );

      if (adminCheck.rows.length > 0) {
        return res.status(409).json({
          error: "Delete your teams before deleting your account"
        });
      }

      return res.status(404).json({
        error: "User not found"
      });
    }

    return res.status(200).json({
      message: "User account deleted successfully",
      user: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
