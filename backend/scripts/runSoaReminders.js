import "dotenv/config";
import pool from "../config/db.js";
import { runSoaReminderJob } from "../services/soaReminderScheduler.js";

try {
  const summary = await runSoaReminderJob({ timeZone: process.env.SOA_REMINDER_TIMEZONE || "Asia/Manila" });
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error("SOA reminder job failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
