import express from '../../backend/node_modules/express/index.js';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import pool from '../../backend/config/db.js';
import analyticsRoutes from '../../backend/routes/analyticsRoutes.js';
import unitRoutes from '../../backend/routes/unitRoutes.js';
import errorHandler from '../../backend/middleware/errorHandler.js';
let server;
try {
  const admin=(await pool.query("SELECT id, auth_version FROM users WHERE role='ADMIN' AND is_active=TRUE ORDER BY id LIMIT 1")).rows[0];
  if(!admin) throw new Error('No active Admin available for the read-only smoke check.');
  const app=express();app.use('/api/analytics',analyticsRoutes);app.use('/api/units',unitRoutes);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const headers={Authorization:'Bearer '+jwt.sign({id:admin.id,authVersion:admin.auth_version},process.env.JWT_SECRET,{expiresIn:'1m'})};
  const base=`http://127.0.0.1:${server.address().port}`;
  const listResponse=await fetch(base+'/api/units',{headers});
  if(!listResponse.ok) throw new Error('Unit list read failed: '+listResponse.status);
  const list=await listResponse.json();
  const sample=(await pool.query('SELECT unit_id FROM meter_readings ORDER BY billing_period_id DESC LIMIT 1')).rows[0];
  if(sample) {
    const response=await fetch(base+'/api/analytics/units/'+sample.unit_id,{headers});
    if(!response.ok) throw new Error('Unit analytics read failed: '+response.status);
    const data=await response.json();
    if(!data.unit || !Array.isArray(data.history) || !Array.isArray(data.forecasts)) throw new Error('Unexpected unit analytics response.');
    if(data.history.some(row=>String(row.unitId)!==String(sample.unit_id))) throw new Error('History contains another unit.');
    console.log(JSON.stringify({check:'PASS: read-only authenticated staff endpoints',units:list.units.length,historyMonths:data.history.length,forecasts:data.forecasts.length}));
  } else console.log('PASS: staff unit list read; no readings available for the history smoke check.');
} finally {
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
}
