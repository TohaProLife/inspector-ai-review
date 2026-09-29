import { Pool } from "pg";
import { provisionLocalUser } from "./user-provisioning.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const connectionString = required("DATABASE_URL");
const password = required("INSPECTOR_USER_PASSWORD");
const pool = new Pool({ connectionString, max: 1 });

try {
  const result = await provisionLocalUser(pool, {
    organizationSlug: process.env.INSPECTOR_ORGANIZATION_SLUG?.trim() || "local",
    login: required("INSPECTOR_USER_LOGIN"),
    displayName: required("INSPECTOR_USER_DISPLAY_NAME"),
    password,
    role: process.env.INSPECTOR_USER_ROLE?.trim() || "INSPECTOR",
    capabilities: (process.env.INSPECTOR_USER_CAPABILITIES || "REVIEW_DECIDE,SOURCE_REVIEW").split(","),
    objectApiIds: (process.env.INSPECTOR_USER_OBJECT_IDS || "").split(","),
    objectPermissions: (
      process.env.INSPECTOR_USER_OBJECT_PERMISSIONS
      || "READ,UPLOAD,RUN,REVIEW_DECIDE,FINALIZE"
    ).split(","),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
