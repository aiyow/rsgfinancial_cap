import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import pool from '../config/db.js';
import { validateBody } from '../middleware/validate.js';
import { sendRegistrationCode } from "../services/email.js";
import {
  createRegistrationOtp,
  createRegistrationToken,
  registrationHash,
  registrationOtpMatches,
  registrationExpiry,
  lockRegistrationEmail,
  registrationQuota,
  REGISTRATION_MAX_ATTEMPTS,
  REGISTRATION_COOLDOWN_SECONDS,
} from "../services/accounts.js";

const router = express.Router();
const email = z.string().trim().toLowerCase().email().max(255);
const sendSchema = z.object({ email }).strict();
const verifySchema = z.object({ email, challengeId: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your email.') }).strict();
function failure(error, res, next) {
  if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
  if (error.status) return res.status(error.status).json({ message:error.message, ...(error.code ? { code:error.code } : {}),
    ...(error.retryAfterSeconds ? { retryAfterSeconds:error.retryAfterSeconds } : {}) });
  return next(error);
}

router.post('/register/send-otp', validateBody(sendSchema), async (req,res,next) => {
  res.set('Cache-Control','no-store');
  let client;
  try {
    const { email } = req.validatedBody;
    await registrationQuota(pool,'send-ip',req.ip,20,3600);
    await registrationQuota(pool,'send-email',email,5,3600);
    client = await pool.connect(); await client.query('BEGIN'); await lockRegistrationEmail(client,email);
    if ((await client.query('SELECT 1 FROM users WHERE LOWER(BTRIM(email))=$1 LIMIT 1',[email])).rowCount) {
      await client.query('ROLLBACK'); return res.status(409).json({ message:'This email is already registered. Sign in or reset your password.' });
    }
    const before = (await client.query(`SELECT id,expires_at AS "expiresAt",(otp_hash IS NOT NULL AND expires_at>NOW() AND attempts<5) AS usable,GREATEST(0,CEIL(EXTRACT(EPOCH FROM last_sent_at+INTERVAL '60 seconds'-NOW())))::int AS cooldown
      FROM registration_challenges WHERE email=$1 FOR UPDATE`,[email])).rows[0];
    if (before?.cooldown>0) {
      await client.query('ROLLBACK');
      if (before.usable) return res.json({ message:'Use the code already sent to your email.', challengeId:before.id,
        expiresAt:before.expiresAt, retryAfterSeconds:before.cooldown, alreadySent:true });
      res.set('Retry-After',String(before.cooldown));
      return res.status(429).json({ message:'A code was just sent. Wait before requesting another.',retryAfterSeconds:before.cooldown });
    }
    const id=randomUUID(), otp=createRegistrationOtp(), expiresAt=registrationExpiry();
    await client.query(`INSERT INTO registration_challenges(email,id,otp_hash,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(email) DO UPDATE SET id=EXCLUDED.id,otp_hash=EXCLUDED.otp_hash,verified_token_hash=NULL,
      attempts=0,expires_at=EXCLUDED.expires_at,last_sent_at=NOW()`,[email,id,registrationHash('otp',id,email,otp),expiresAt]);
    try { await sendRegistrationCode({ email, otp }); }
    catch { throw Object.assign(new Error('We could not send your code. Check your email address or try again later.'),{status:503}); }
    await client.query('COMMIT');
    return res.json({ message:'Enter the code sent to your email. Check your inbox and spam folder.',challengeId:id,expiresAt,retryAfterSeconds:REGISTRATION_COOLDOWN_SECONDS });
  } catch(error) { if(client)await client.query('ROLLBACK').catch(()=>{});return failure(error,res,next); }
  finally { client?.release(); }
});

router.post('/register/verify-otp', validateBody(verifySchema), async (req,res,next) => {
  res.set('Cache-Control','no-store');
  let client;
  try {
    const { email,challengeId,otp }=req.validatedBody;
    await registrationQuota(pool,'verify-ip',req.ip,60,900);
    client=await pool.connect();await client.query('BEGIN');await lockRegistrationEmail(client,email);
    const challenge=(await client.query('SELECT *,expires_at>NOW() AS valid FROM registration_challenges WHERE email=$1 AND id=$2 FOR UPDATE',[email,challengeId])).rows[0];
    if(!challenge?.valid || !challenge.otp_hash) throw Object.assign(new Error('This code is invalid or expired. Request a new code.'),{status:400});
    if(challenge.attempts>=REGISTRATION_MAX_ATTEMPTS) throw Object.assign(new Error('Too many incorrect attempts. Request a new code.'),{status:429});
    if(!registrationOtpMatches(challenge,email,otp)) {
      await client.query('UPDATE registration_challenges SET attempts=attempts+1 WHERE email=$1',[email]);await client.query('COMMIT');
      const remaining=REGISTRATION_MAX_ATTEMPTS-challenge.attempts-1;
      return res.status(remaining?400:429).json({ message:remaining?`Incorrect code. ${remaining} attempts remaining.`:'Too many incorrect attempts. Request a new code.' });
    }
    const token=createRegistrationToken();const expiresAt=registrationExpiry();
    await client.query('UPDATE registration_challenges SET otp_hash=NULL,verified_token_hash=$2,expires_at=$3 WHERE email=$1',[email,registrationHash('grant',email,token),expiresAt]);
    await client.query('COMMIT');return res.json({ message:'Email verified. Complete your account details.',registrationToken:token,expiresAt });
  } catch(error) { if(client)await client.query('ROLLBACK').catch(()=>{});return failure(error,res,next); }
  finally { client?.release(); }
});
export default router;
