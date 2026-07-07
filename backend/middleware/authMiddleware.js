import jwt from "jsonwebtoken";
import pool from "../config/db.js";

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication token is required.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT id, role, is_active
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ message: "Account is unavailable or inactive." });
    }

    req.user = {
      id: result.rows[0].id,
      role: result.rows[0].role,
    };

    next();
  } catch (error) {
    if (error.code) return next(error);
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
}

function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to access this page.",
      });
    }

    next();
  };
}

export { requireAuth, allowRoles };
