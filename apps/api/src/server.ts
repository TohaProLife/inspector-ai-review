import { buildApp } from "./app.js";
import { PostgresIdentityService } from "./identity.js";
import { createInspectionRepositoryFromEnv } from "./repository-factory.js";

const port = Number(process.env.API_PORT ?? 4100);
const host = process.env.API_HOST ?? "0.0.0.0";
const repository = await createInspectionRepositoryFromEnv();
const identityService = process.env.DATABASE_URL
  ? PostgresIdentityService.create({
      connectionString: process.env.DATABASE_URL,
      organizationSlug: process.env.INSPECTOR_ORGANIZATION_SLUG,
    })
  : undefined;
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === "1"
  || (process.env.SESSION_COOKIE_SECURE === undefined && process.env.NODE_ENV === "production");
const publicReviewObjectIds = process.env.INSPECTOR_PUBLIC_REVIEW_OBJECT_IDS
  ?.split(",").map((id) => id.trim()).filter(Boolean);
if (publicReviewObjectIds?.length && (publicReviewObjectIds.length !== 3
  || new Set(publicReviewObjectIds).size !== 3
  || publicReviewObjectIds.some((id) => !/^OBJ-[A-Z0-9-]{3,80}$/.test(id)))) {
  throw new Error("INSPECTOR_PUBLIC_REVIEW_OBJECT_IDS must contain exactly three distinct object IDs");
}
const app = await buildApp({
  logger: true,
  repository,
  identityService,
  allowedOrigins,
  sessionCookieSecure,
  publicReviewObjectIds,
  openWorkspace: process.env.INSPECTOR_OPEN_WORKSPACE === "1",
  workerToken: process.env.INTERNAL_WORKER_TOKEN,
});

await app.listen({ port, host });
