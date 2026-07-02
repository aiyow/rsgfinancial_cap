import express from "express";
import {
  requireAuth,
  allowRoles,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.get(
  "/admin",
  requireAuth,
  allowRoles("ADMIN"),
  (req, res) => {
    res.json({
      message: "Welcome to the Admin dashboard.",
      user: req.user,
    });
  }
);

router.get(
  "/collector",
  requireAuth,
  allowRoles("COLLECTOR"),
  (req, res) => {
    res.json({
      message: "Welcome to the Collector dashboard.",
      user: req.user,
    });
  }
);

router.get(
  "/owner",
  requireAuth,
  allowRoles("UNIT_OWNER"),
  (req, res) => {
    res.json({
      message: "Welcome to the Unit Owner dashboard.",
      user: req.user,
    });
  }
);

export default router;
