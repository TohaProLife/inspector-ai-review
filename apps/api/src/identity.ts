import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { Pool, type QueryResultRow } from "pg";

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export interface AuthenticatedActor {
  sessionId: string;
  userId: string;
  displayName: string;
  organizationId: string;
  roles: string[];
  capabilities: string[];
  csrfHash: string;
  expiresAt: string;
}

export interface LoginResult {
  actor: AuthenticatedActor;
  sessionToken: string;
  csrfToken: string;
}

export interface IdentityService {
  login(login: string, password: string): Promise<LoginResult | undefined>;
  createPublicVisitorSession?(objectApiIds: string[]): Promise<LoginResult | undefined>;
  createOpenWorkspaceSession?(): Promise<LoginResult | undefined>;
  resolveSession(sessionToken: string): Promise<AuthenticatedActor | undefined>;
  verifyCsrf(actor: AuthenticatedActor, csrfToken: string): boolean;
  revokeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

interface IdentityServiceOptions {
  connectionString: string;
  organizationSlug?: string;
  sessionTtlMs?: number;
}

interface MembershipRow extends QueryResultRow {
  session_id?: string;
  user_id: string;
  display_name: string;
  organization_id: string;
  role: string;
  capabilities: string[];
  csrf_hash?: string;
  expires_at?: Date | string;
}

interface UserRow extends QueryResultRow {
  id: string;
  password_hash: string | null;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 512) {
    throw new Error("Password must contain between 12 and 512 characters");
  }
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!match) return false;
  const [, n, r, p, saltValue, digestValue] = match;
  if (Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P) return false;
  const expected = Buffer.from(digestValue, "base64url");
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await derivePassword(password, Buffer.from(saltValue, "base64url"));
  return timingSafeEqual(actual, expected);
}

function actorFromRows(rows: MembershipRow[]): AuthenticatedActor | undefined {
  const first = rows[0];
  if (!first?.session_id || !first.csrf_hash || !first.expires_at) return undefined;
  return {
    sessionId: first.session_id,
    userId: first.user_id,
    displayName: first.display_name,
    organizationId: first.organization_id,
    roles: [...new Set(rows.map((row) => row.role))].sort(),
    capabilities: [...new Set(rows.flatMap((row) => row.capabilities))].sort(),
    csrfHash: first.csrf_hash,
    expiresAt: new Date(first.expires_at).toISOString(),
  };
}

export class PostgresIdentityService implements IdentityService {
  private readonly organizationSlug: string;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly pool: Pool,
    options: Pick<IdentityServiceOptions, "organizationSlug" | "sessionTtlMs"> = {},
  ) {
    this.organizationSlug = options.organizationSlug ?? "local";
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  }

  static create(options: IdentityServiceOptions): PostgresIdentityService {
    return new PostgresIdentityService(new Pool({ connectionString: options.connectionString }), options);
  }

  async createOpenWorkspaceSession(): Promise<LoginResult | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const organization = await client.query<{ id: string }>(
        "SELECT id FROM organizations WHERE slug = $1", [this.organizationSlug],
      );
      const organizationId = organization.rows[0]?.id;
      if (!organizationId) { await client.query("ROLLBACK"); return undefined; }
      // Simultaneous first visits can collide on either unique identity key.
      await client.query(
        `INSERT INTO inspector_users (login, provider_subject, display_name)
         VALUES ('open-workspace', 'open-workspace-v1', 'Рабочее место')
         ON CONFLICT DO NOTHING`,
      );
      const users = await client.query<{ id: string }>(
        `SELECT id FROM inspector_users
         WHERE login = 'open-workspace' AND provider_subject = 'open-workspace-v1'
           AND password_hash IS NULL AND enabled = true`,
      );
      const userId = users.rows[0]?.id;
      if (!userId) { await client.query("ROLLBACK"); return undefined; }
      const capabilities = ["OBJECT_CREATE", "REVIEW_DECIDE", "SOURCE_REVIEW"];
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, capabilities)
         VALUES ($1, $2, 'SUPERVISOR', $3::text[])
         ON CONFLICT (organization_id, user_id, role) DO UPDATE
         SET capabilities = EXCLUDED.capabilities, revoked_at = NULL`,
        [organizationId, userId, capabilities],
      );
      await client.query(
        `INSERT INTO object_memberships (object_id, user_id, permission_set)
         SELECT id, $2, ARRAY['READ', 'UPLOAD', 'RUN', 'REVIEW_DECIDE', 'FINALIZE']::text[]
         FROM objects WHERE organization_id = $1
         ON CONFLICT (object_id, user_id) DO UPDATE
         SET permission_set = EXCLUDED.permission_set, revoked_at = NULL`,
        [organizationId, userId],
      );
      const sessionToken = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + this.sessionTtlMs);
      const session = await client.query<{ id: string }>(
        `INSERT INTO user_sessions (user_id, token_hash, csrf_hash, auth_version, expires_at)
         SELECT id, $2, $3, auth_version, $4 FROM inspector_users WHERE id = $1
         RETURNING id`,
        [userId, tokenHash(sessionToken), tokenHash(csrfToken), expiresAt],
      );
      await client.query("COMMIT");
      return {
        sessionToken, csrfToken,
        actor: { sessionId: session.rows[0].id, userId, displayName: "Рабочее место",
          organizationId, roles: ["SUPERVISOR"], capabilities,
          csrfHash: tokenHash(csrfToken), expiresAt: expiresAt.toISOString() },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createPublicVisitorSession(objectApiIds: string[]): Promise<LoginResult | undefined> {
    if (objectApiIds.length !== 3 || new Set(objectApiIds).size !== 3
      || objectApiIds.some((id) => !/^OBJ-[A-Z0-9-]{3,80}$/.test(id))) return undefined;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const organization = await client.query<{ id: string }>(
        "SELECT id FROM organizations WHERE slug = $1", [this.organizationSlug],
      );
      const organizationId = organization.rows[0]?.id;
      if (!organizationId) { await client.query("ROLLBACK"); return undefined; }
      const objects = await client.query<{ id: string; api_id: string }>(
        `SELECT id, api_id FROM objects
         WHERE organization_id = $1 AND api_id = ANY($2::text[])
         ORDER BY api_id FOR UPDATE`, [organizationId, objectApiIds],
      );
      if (objects.rows.length !== 3) { await client.query("ROLLBACK"); return undefined; }
      await client.query(
        `INSERT INTO inspector_users (login, provider_subject, display_name)
         VALUES ('public-review-visitor', 'public-review-visitor-v1', 'Публичный просмотр')
         ON CONFLICT DO NOTHING`,
      );
      const users = await client.query<{ id: string }>(
        `SELECT id FROM inspector_users
         WHERE login = 'public-review-visitor'
           AND provider_subject = 'public-review-visitor-v1'
           AND password_hash IS NULL AND enabled = true`,
      );
      const userId = users.rows[0]?.id;
      if (!userId) { await client.query("ROLLBACK"); return undefined; }
      await client.query(
        `UPDATE organization_memberships SET revoked_at = now()
         WHERE organization_id = $1 AND user_id = $2 AND role <> 'CURATOR' AND revoked_at IS NULL`,
        [organizationId, userId],
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, capabilities)
         VALUES ($1, $2, 'CURATOR', ARRAY[]::text[])
         ON CONFLICT (organization_id, user_id, role) DO UPDATE
         SET capabilities = ARRAY[]::text[], revoked_at = NULL`, [organizationId, userId],
      );
      await client.query(
        `UPDATE object_memberships SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
           AND NOT (object_id = ANY($2::uuid[]))`,
        [userId, objects.rows.map((object) => object.id)],
      );
      for (const object of objects.rows) {
        await client.query(
          `INSERT INTO object_memberships (object_id, user_id, permission_set)
           VALUES ($1, $2, ARRAY['READ']::text[])
           ON CONFLICT (object_id, user_id) DO UPDATE
           SET permission_set = ARRAY['READ']::text[], revoked_at = NULL`,
          [object.id, userId],
        );
      }
      const sessionToken = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + this.sessionTtlMs);
      const session = await client.query<{ id: string }>(
        `INSERT INTO user_sessions (user_id, token_hash, csrf_hash, auth_version, expires_at)
         SELECT id, $2, $3, auth_version, $4 FROM inspector_users WHERE id = $1
         RETURNING id`,
        [userId, tokenHash(sessionToken), tokenHash(csrfToken), expiresAt],
      );
      await client.query("COMMIT");
      return {
        sessionToken, csrfToken,
        actor: { sessionId: session.rows[0].id, userId, displayName: "Публичный просмотр",
          organizationId, roles: ["CURATOR"], capabilities: [],
          csrfHash: tokenHash(csrfToken), expiresAt: expiresAt.toISOString() },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async login(login: string, password: string): Promise<LoginResult | undefined> {
    const normalizedLogin = login.trim().toLowerCase();
    const user = await this.pool.query<UserRow>(
      `SELECT id, password_hash
       FROM inspector_users
       WHERE login = $1 AND enabled = true`,
      [normalizedLogin],
    );
    const passwordHash = user.rows[0]?.password_hash;
    if (!passwordHash) {
      await derivePassword(password, Buffer.alloc(16));
      return undefined;
    }
    if (!(await verifyPassword(password, passwordHash))) return undefined;

    const memberships = await this.pool.query<MembershipRow>(
      `SELECT
         user_account.id AS user_id,
         user_account.display_name,
         organization.id AS organization_id,
         membership.role,
         membership.capabilities
       FROM inspector_users user_account
       JOIN organization_memberships membership
         ON membership.user_id = user_account.id AND membership.revoked_at IS NULL
       JOIN organizations organization ON organization.id = membership.organization_id
       WHERE user_account.id = $1 AND user_account.enabled = true AND organization.slug = $2
       ORDER BY membership.role`,
      [user.rows[0].id, this.organizationSlug],
    );
    if (memberships.rows.length === 0) return undefined;

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    const inserted = await this.pool.query<{ id: string; auth_version: string | number }>(
      `INSERT INTO user_sessions (
         user_id, token_hash, csrf_hash, auth_version, expires_at
       )
       SELECT id, $2, $3, auth_version, $4
       FROM inspector_users
       WHERE id = $1 AND enabled = true
       RETURNING id, auth_version`,
      [user.rows[0].id, tokenHash(sessionToken), tokenHash(csrfToken), expiresAt],
    );
    if (!inserted.rows[0]) return undefined;

    const rows = memberships.rows.map((row) => ({
      ...row,
      session_id: inserted.rows[0].id,
      csrf_hash: tokenHash(csrfToken),
      expires_at: expiresAt,
    }));
    const actor = actorFromRows(rows);
    if (!actor) throw new Error("Created session could not be resolved");
    return { actor, sessionToken, csrfToken };
  }

  async resolveSession(sessionToken: string): Promise<AuthenticatedActor | undefined> {
    if (sessionToken.length < 32 || sessionToken.length > 256) return undefined;
    const memberships = await this.pool.query<MembershipRow>(
      `SELECT
         session.id AS session_id,
         session.csrf_hash,
         session.expires_at,
         user_account.id AS user_id,
         user_account.display_name,
         organization.id AS organization_id,
         membership.role,
         membership.capabilities
       FROM user_sessions session
       JOIN inspector_users user_account
         ON user_account.id = session.user_id
        AND user_account.enabled = true
        AND user_account.auth_version = session.auth_version
       JOIN organization_memberships membership
         ON membership.user_id = user_account.id AND membership.revoked_at IS NULL
       JOIN organizations organization ON organization.id = membership.organization_id
       WHERE session.token_hash = $1
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND organization.slug = $2
       ORDER BY membership.role`,
      [tokenHash(sessionToken), this.organizationSlug],
    );
    return actorFromRows(memberships.rows);
  }

  verifyCsrf(actor: AuthenticatedActor, csrfToken: string): boolean {
    if (csrfToken.length < 32 || csrfToken.length > 256) return false;
    return constantTimeHexEqual(actor.csrfHash, tokenHash(csrfToken));
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1`,
      [sessionId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
