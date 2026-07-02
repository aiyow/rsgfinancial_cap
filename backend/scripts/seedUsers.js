import "dotenv/config";
import bcrypt from "bcrypt";
import pool from "../config/db.js";

async function seedUsers() {
  const users = [
    {
      fullName: "System Admin",
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      role: "ADMIN",
    },
    {
      fullName: "Billing Collector",
      email: process.env.SEED_COLLECTOR_EMAIL,
      password: process.env.SEED_COLLECTOR_PASSWORD,
      role: "COLLECTOR",
    },
  ];

  const missingVariables = users.flatMap((user) => {
    const missing = [];

    if (!user.email) missing.push(`${user.role} email`);
    if (!user.password) missing.push(`${user.role} password`);

    return missing;
  });

  if (missingVariables.length > 0) {
    console.error(
      `Missing seed configuration: ${missingVariables.join(", ")}. ` +
        "Add the SEED_* values to .env before running npm run seed."
    );
    await pool.end();
    process.exitCode = 1;
    return;
  }

  try {
    for (const user of users) {
      const existingUser = await pool.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
        [user.email]
      );

      if (existingUser.rows.length > 0) {
        console.log(`${user.role} already exists: ${user.email}`);
        continue;
      }

      const passwordHash = await bcrypt.hash(user.password, 12);

      await pool.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)`,
        [
          user.fullName,
          user.email.toLowerCase(),
          passwordHash,
          user.role,
        ]
      );

      console.log(`${user.role} created: ${user.email}`);
    }
  } catch (error) {
    console.error("Seeding error:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedUsers();
