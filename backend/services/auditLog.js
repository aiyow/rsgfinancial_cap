import pool from "../config/db.js";

function dbClient(client) {
  return client?.query ? client : pool;
}

export async function writeAuditLog({
  client,
  actorUserId,
  entityName,
  entityId = null,
  action,
  oldValues = null,
  newValues = null,
  remarks = null,
}) {
  await dbClient(client).query(
    `INSERT INTO audit_logs
      (actor_user_id, entity_name, entity_id, action, old_values, new_values, remarks)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      actorUserId,
      entityName,
      entityId,
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      remarks,
    ],
  );
}
