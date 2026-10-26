import pool from "../config/db.js";
import { enrichAuditContext, sameAuditValues, sanitizeAudit } from './auditDetails.js';

function dbClient(client) {
  return client?.query ? client : pool;
}

export async function writeAuditLog({
  client,
  actorUserId = null,
  entityName,
  entityId = null,
  action,
  oldValues = null,
  newValues = null,
  remarks = null,
  context = {},
}) {
  // Activity Log is reserved for changes initiated by an identified user.
  if (!actorUserId || context.origin === 'SYSTEM') return false;
  oldValues = sanitizeAudit(oldValues);
  newValues = sanitizeAudit(newValues);
  if (oldValues && newValues && ['UPDATE', 'UPDATE_PROFILE', 'EDIT_INVOICES', 'PAYMENT_REFERENCES_UPDATED', 'SOA_EDITED'].includes(action) && sameAuditValues(oldValues, newValues)) return false;
  const database = dbClient(client);
  context = await enrichAuditContext(database, { actorUserId, entityName, entityId, oldValues, newValues, context });
  await database.query(
    `INSERT INTO audit_logs
      (actor_user_id, actor_name_snapshot, actor_role_snapshot, entity_name, entity_id, action, old_values, new_values, remarks, context)
     VALUES (
       $1,
       (SELECT full_name FROM users WHERE id = $1),
       (SELECT role FROM users WHERE id = $1),
       $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb
     )`,
    [
      actorUserId,
      entityName,
      entityId,
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      remarks,
      JSON.stringify(context),
    ],
  );
  return true;
}
