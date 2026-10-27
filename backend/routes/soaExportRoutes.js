import express from 'express';
import { z } from 'zod';
import pool from '../config/db.js';
import { requireAuth, allowRoles } from '../middleware/authMiddleware.js';
import { createProtectedSoaExportService } from '../services/protectedSoaExports.js';

export const protectedSoaExports = createProtectedSoaExportService({ db: pool });
export function createSoaExportRouter(service = protectedSoaExports) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!/^\/(?:bills\/[^/]+\/protected-exports|soa-exports\/[^/]+(?:\/file)?)\/?$/.test(req.path)) return next('router');
    return next();
  });
  router.use((req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  router.use(requireAuth, allowRoles('RESIDENT'));
  const uuid = z.string().uuid();
  function failure(error, res) {
    // Never send/log renderer, SQL, qpdf or SMTP exception text from this boundary.
    const status = error.status || 503;
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(status).json({ code: error.status ? error.code : 'PROTECTED_EXPORT_UNAVAILABLE',
      message: error.status ? error.message : 'Protected SOA downloads are temporarily unavailable. Please try again later.',
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    });
  }
  router.post('/bills/:id/protected-exports', async (req, res) => {
    const id = Number(req.params.id), key = req.get('Idempotency-Key');
    if (!Number.isSafeInteger(id) || id <= 0 || !uuid.safeParse(key).success || Object.keys(req.body || {}).length) return res.status(400).json({ message: 'A statement ID and UUID Idempotency-Key are required. Do not send document or email data.' });
    try {
      const data = await service.create(id, req.user.id, key, req.ip);
      return res.status(['PREPARING', 'EMAIL_PENDING'].includes(data.status) ? 202 : 200).json(data);
    } catch (error) { return failure(error, res); }
  });
  router.get('/soa-exports/:exportId', async (req, res) => {
    if (!uuid.safeParse(req.params.exportId).success) return res.status(404).json({ message: 'Protected export not found.' });
    try { return res.json(await service.read(req.params.exportId, req.user.id)); }
    catch (error) { return failure(error, res); }
  });
  router.get('/soa-exports/:exportId/file', async (req, res) => {
    if (!uuid.safeParse(req.params.exportId).success) return res.status(404).json({ message: 'Protected export not found.' });
    try {
      const data = await service.read(req.params.exportId, req.user.id, true);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${data.filename}"` });
      return res.send(data.bytes);
    } catch (error) { return failure(error, res); }
  });
  return router;
}
export default createSoaExportRouter();
