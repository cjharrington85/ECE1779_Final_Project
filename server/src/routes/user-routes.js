
const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/me", authenticate, async (req, res, next) => {
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

module.exports = router;
