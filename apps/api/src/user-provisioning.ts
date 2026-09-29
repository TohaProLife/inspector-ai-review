import type { Pool } from "pg";
import { hashPassword } from "./identity.js";

const allowedRoles = new Set([
  "INSPECTOR",
  "SUPERVISOR",
  "ADMIN",
  "ML_ENGINEER",
  "CURATOR",
  "INTEGRATION_SERVICE",
]);

export interface ProvisionLocalUserInput {
  organizationSlug: string;
  login: string;
  displayName: string;
  password: string;
  role?: string;
  capabilities?: string[];
  objectApiIds?: string[];
  objectPermissions?: string[];
}

export interface ProvisionedLocalUser {
  id: string;
  login: string;
  organizationId: string;
  objectApiIds: string[];
}

function normalizedList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export async function provisionLocalUser(
  pool: Pool,
  input: ProvisionLocalUserInput,
): Promise<ProvisionedLocalUser> {
  const login = input.login.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const role = input.role ?? "INSPECTOR";
  const capabilities = normalizedList(input.capabilities ?? ["REVIEW_DECIDE", "SOURCE_REVIEW"]);
  const objectApiIds = normalizedList(input.objectApiIds ?? []);
  const objectPermissions = normalizedList(
    input.objectPermissions ?? ["READ", "UPLOAD", "RUN", "REVIEW_DECIDE", "FINALIZE"],
  );
  if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) throw new Error("Login has an invalid format");
  if (displayName.length < 2 || displayName.length > 180) throw new Error("Display name has an invalid length");
  if (!allowedRoles.has(role)) throw new Error(`Unsupported role: ${role}`);
  if (objectApiIds.length > 0 && objectPermissions.length === 0) {
    throw new Error("Object permissions are required when object IDs are provided");
  }
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organization = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = $1 FOR UPDATE`,
      [input.organizationSlug],
    );
    if (!organization.rows[0]) throw new Error(`Organization ${input.organizationSlug} was not found`);
    const organizationId = organization.rows[0].id;
    const user = await client.query<{ id: string }>(
      `INSERT INTO inspector_users (login, password_hash, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (login) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name,
           enabled = true,
           auth_version = inspector_users.auth_version + 1,
           updated_at = now()
       RETURNING id`,
      [login, passwordHash, displayName],
    );
    const userId = user.rows[0].id;
    await client.query(
      `UPDATE organization_memberships
       SET revoked_at = now()
       WHERE organization_id = $1
         AND user_id = $2
         AND role <> $3
         AND revoked_at IS NULL`,
      [organizationId, userId, role],
    );
    await client.query(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, capabilities, revoked_at
       ) VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (organization_id, user_id, role) DO UPDATE
       SET capabilities = EXCLUDED.capabilities, revoked_at = NULL`,
      [organizationId, userId, role, capabilities],
    );

    await client.query(
      `UPDATE object_memberships membership
       SET revoked_at = now()
       FROM objects object
       WHERE membership.object_id = object.id
         AND object.organization_id = $1
         AND membership.user_id = $2
         AND NOT (object.api_id = ANY($3::text[]))
         AND membership.revoked_at IS NULL`,
      [organizationId, userId, objectApiIds],
    );

    if (objectApiIds.length > 0) {
      const objects = await client.query<{ id: string; api_id: string }>(
        `SELECT id, api_id
         FROM objects
         WHERE organization_id = $1 AND api_id = ANY($2::text[])
         ORDER BY api_id
         FOR UPDATE`,
        [organizationId, objectApiIds],
      );
      const found = new Set(objects.rows.map((object) => object.api_id));
      const missing = objectApiIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new Error(`Objects not found in organization: ${missing.join(", ")}`);
      for (const object of objects.rows) {
        await client.query(
          `INSERT INTO object_memberships (object_id, user_id, permission_set, revoked_at)
           VALUES ($1, $2, $3, NULL)
           ON CONFLICT (object_id, user_id) DO UPDATE
           SET permission_set = EXCLUDED.permission_set, revoked_at = NULL`,
          [object.id, userId, objectPermissions],
        );
      }
    }

    await client.query("COMMIT");
    return { id: userId, login, organizationId, objectApiIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
