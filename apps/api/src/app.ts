import { registerSourceOcrImportRoutes } from "./source-ocr-import-routes.js";
import { finalizedObjectReason, readObjectPermissions } from "./object-permissions.js";
import { registerNativeAirflowRoutes } from "./native-airflow-routes.js";
import { registerNativeCapacityRoutes } from "./native-capacity-routes.js";
import { parseDocumentTextV4FullCompletion } from "./document-text-v4-full-wire.js";
import { documentTextV4FullPageBatch } from "./document-text-v4-full-batch.js";
import {parseSteelApplicabilityReviewInput,SteelApplicabilityReviewValidationError} from "./matrix-steel-applicability-review.js";
import {assertSteelComparisonReviewNative,SteelComparisonReviewValidationError} from "./matrix-steel-review.js";
import {matrixLightingTechnologySelectionSchema} from '@inspector-ai/contracts';
import {LightingTechnologyReviewValidationError} from './matrix-lighting-technology-review.js';
import {assertWaterNodeReviewNative,WaterNodeReviewValidationError} from './matrix-water-node-review.js';
import {matrixWaterNodeInventorySelectionSchema} from '@inspector-ai/contracts';
import {assertRailInventoryReviewNative,RailInventoryReviewValidationError} from './matrix-rail-inventory-review.js';
import {matrixRailInventorySelectionSchema} from '@inspector-ai/contracts';
import {assertCallInventoryReviewNative,CallInventoryReviewValidationError} from './matrix-call-inventory-review.js';
import {matrixCallInventorySelectionSchema} from '@inspector-ai/contracts';
import { Readable } from "node:stream";
import { z } from "zod";
import { assertInventoryReviewNative, validateInventoryReviewJsonBytes, InventoryReviewValidationError } from "./matrix-inventory-review.js";
import { matrixInventorySelectionSchema } from "@inspector-ai/contracts";
import {canonicalJson,sha256} from "./canonical-json.js";
import {parseDocumentTextV3LargeCompletion} from "./document-text-v3-large-wire.js";
import { loadTrustedGeometryRegistration } from "./geometry-trust-store.js";
import { readVerifiedOriginalPdf } from "./verified-pdf-storage.js";
import { registerLocalRegistrationRoutes } from "./local-registration-routes.js";
import { registerDocumentCoordinateRoutes } from "./document-coordinate-routes.js";
import { registerDrainageSourceRoutes } from "./drainage-source-routes.js";
import { registerPpm113SourceRoutes } from "./ppm113-source-routes.js";
import { registerColumnPylonSectionV2Routes, ColumnPylonSectionWireError } from "./column-pylon-section-v2-routes.js";
import type { PostgresLocalRegistrationService } from "./postgres-local-registration.js";
import cookie from "@fastify/cookie";
import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { ZodError } from "zod";
import {
  type CheckRun,
  createObjectSchema,
  decisionSchema,
  finalizeCheckSchema,
  loginSchema,
  revokeProtocolSchema,
  sourceReviewSchema,
  uploadPolicy,
  uploadStageSchema,
} from "@inspector-ai/contracts";
import { fastifySchemaFor } from "./api-contract.js";
import { FileIngestError, ingestMultipartFiles } from "./ingest.js";
import { parseNormalizedCrop, PdfPreviewError, renderVerifiedPdfPage } from "./pdf-preview.js";
import type { AuthenticatedActor, IdentityService } from "./identity.js";
import { createMalwareScannerFromEnv, type MalwareScanner } from "./malware-scanner.js";
import { openApiDocument } from "./openapi.js";
import type {
  InspectionRepository,
  JobAttemptInput,
  JobClaimInput,
  JobCompleteInput,
  JobFailInput,
  ScopedReadResult,
  VisualProposalReviewInput,
  ReviewCandidateDecisionInput,
  FactEntityLinkReviewInput,
  OcrRowTranscriptionReviewInput,
  OcrRowApplicabilityReviewInput,
  OcrFactPairReviewInput,
  OcrFactPairQuantityReviewInput,
} from "./repository.js";
import { createObjectStorageFromEnv, type ObjectStorage } from "./storage.js";
import { InspectorStore } from "./store.js";
import { registerProtocolReportRoutes } from "./protocol-report-routes.js";
import { registerIaisPullRoutes } from "./iais-pull-routes.js";

interface AppOptions {
  localRegistrationService?: PostgresLocalRegistrationService;
  repository?: InspectionRepository;
  store?: InspectorStore;
  storage?: ObjectStorage;
  logger?: boolean;
  maxFileBytes?: number;
  maxUploadBytes?: number;
  malwareScanner?: MalwareScanner;
  identityService?: IdentityService;
  allowedOrigins?: string[];
  sessionCookieSecure?: boolean;
  publicReviewObjectIds?: string[];
  openWorkspace?: boolean;
  workerToken?: string;
}

const SESSION_COOKIE = "inspector_session";
const CSRF_COOKIE = "inspector_csrf";
const OCR_ROW_REVIEW_INPUT_FIELDS = ["schemaVersion", "ocrStageSha256", "rowFingerprint",
  "decision", "reviewedLabel", "reviewedValue", "reviewedUnit", "basis"] as const;
const OCR_ROW_APPLICABILITY_INPUT_FIELDS = ["schemaVersion", "decision", "targetCheckId",
  "sourceFileId", "sourceSha256", "pageNumber", "renderSha256", "ocrStageSha256",
  "rowFingerprint", "transcriptionDecisionId", "transcriptionDecisionHash",
  "sourceReviewDecisionId", "sourceReviewDecisionHash", "parameterCode", "attribute",
  "stage", "entityKey", "context", "basis"] as const;
const OCR_FACT_PAIR_INPUT_FIELDS = ["schemaVersion", "decision", "targetCheckId",
  "inputManifestHash", "objectId", "parameterCode", "attribute", "pdFactId",
  "pdLocatorHash", "rdFactId", "rdLocatorHash", "entityKey", "context",
  "linkGroupId", "basis"] as const;
const OCR_FACT_PAIR_QUANTITY_INPUT_FIELDS = ["schemaVersion", "decision",
  "targetCheckId", "inputManifestHash", "objectId", "parameterCode", "attribute",
  "entityKey", "context", "pdFactId", "pdLocatorHash", "rdFactId",
  "rdLocatorHash", "pairDecisionId", "pairTargetReviewHash",
  "pdDenominatorAffirmed", "pdPageNumber", "rdPageNumber", "basis"] as const;

function findingEtag(rowVersion: number): string {
  return `"review-${rowVersion}"`;
}

function parseFindingEtag(value: string | undefined): number | undefined {
  const match = value ? /^(?:W\/)?"review-(\d+)"$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : undefined;
}

function inspectionEtag(rowVersion: number): string {
  return `"inspection-${rowVersion}"`;
}

function parseInspectionEtag(value: string | undefined): number | undefined {
  const match = value ? /^(?:W\/)?"inspection-(\d+)"$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : undefined;
}

function sessionResponse(actor: AuthenticatedActor) {
  return {
    user: {
      id: actor.userId,
      displayName: actor.displayName,
      roles: actor.roles,
      capabilities: actor.capabilities,
      expiresAt: actor.expiresAt,
    },
  };
}

function canOperateInspection(actor: AuthenticatedActor, capability: string): boolean {
  return actor.roles.some((role) => role === "INSPECTOR" || role === "SUPERVISOR")
    || actor.capabilities.includes(capability);
}

function canRevokeProtocol(actor: AuthenticatedActor): boolean {
  return actor.roles.some((role) => role === "SUPERVISOR" || role === "ADMIN");
}

async function inventoryReviewPreParsing(request:FastifyRequest,_reply:FastifyReply,payload:NodeJS.ReadableStream){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of payload){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
    if(length>524288)throw new InventoryReviewValidationError("INPUT_LIMIT","Inventory review exceeds512KiB request limit");chunks.push(bytes);}
  const bytes=Buffer.concat(chunks);validateInventoryReviewJsonBytes(bytes);
  const parsed:unknown=JSON.parse(bytes.toString('utf8'));assertCallInventoryReviewNative(parsed);assertWaterNodeReviewNative(parsed);
  // Fastify AJV may remove additional properties. Reject them before that lossy step.
  if(request.routeOptions.url?.endsWith('/source-inventory-preview'))
    z.object({sourceFileId:z.string().min(1).max(200),selection:matrixInventorySelectionSchema}).strict().parse(parsed);
  else if(request.routeOptions.url?.endsWith('/call-inventory-preview'))z.object({selection:matrixCallInventorySelectionSchema}).strict().parse(parsed);
  else if(request.routeOptions.url?.endsWith('/rail-inventory-preview'))z.object({selection:matrixRailInventorySelectionSchema}).strict().parse(parsed);
  else if(request.routeOptions.url?.endsWith('/water-node-preview'))z.object({selection:matrixWaterNodeInventorySelectionSchema}).strict().parse(parsed);
  else if(request.routeOptions.url?.endsWith('/lighting-technology-preview'))z.object({selection:matrixLightingTechnologySelectionSchema}).strict().parse(parsed);
  else if(request.routeOptions.url?.endsWith('/source-audit-v3')||request.routeOptions.url?.endsWith('/source-audit-v3-large-vertical-v1')||request.routeOptions.url?.endsWith('/source-audit-v4-full-source-v1'))z.object({}).strict().parse(parsed);
  else {assertSteelComparisonReviewNative(parsed);const stages=(parsed as Record<string,any>).pageStages;if(stages&&Object.keys(stages).some(k=>!(/^[1-9][0-9]{0,15}$/.test(k)&&Number.isSafeInteger(Number(k)))))throw new CallInventoryReviewValidationError('INVALID_INPUT','Некорректный номер страницы');sourceReviewSchema.parse(parsed);}
  const stream=Readable.from([bytes]) as Readable&{receivedEncodedLength:number};stream.receivedEncodedLength=bytes.length;return stream;
}

async function steelApplicabilityReviewPreParsing(_request:FastifyRequest,_reply:FastifyReply,payload:NodeJS.ReadableStream){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of payload){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
    if(length>524288)throw new SteelApplicabilityReviewValidationError('INPUT_LIMIT','Превышен объём решения пары');chunks.push(bytes);}
  const bytes=Buffer.concat(chunks);validateInventoryReviewJsonBytes(bytes);
  let parsed:unknown;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw new SteelApplicabilityReviewValidationError('INVALID_INPUT','Некорректный JSON решения пары');}
  parseSteelApplicabilityReviewInput(parsed);
  const stream=Readable.from([bytes]) as Readable&{receivedEncodedLength:number};stream.receivedEncodedLength=bytes.length;return stream;
}

async function largeSourceCompletionPreParsing(_request:FastifyRequest,_reply:FastifyReply,payload:NodeJS.ReadableStream){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of payload){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
    if(length>33554432)throw Object.assign(new Error("Превышен объём результата большого аудита"),{statusCode:413});chunks.push(bytes);}
  const bytes=Buffer.concat(chunks),read=parseDocumentTextV3LargeCompletion(bytes);
  if(read.status!=="VALID")throw Object.assign(new Error(read.reasonCode==="INPUT_LIMIT"?"Превышены пределы результата большого аудита":"Некорректный JSON результата большого аудита"),{statusCode:read.reasonCode==="INPUT_LIMIT"?413:400});
  const stream=Readable.from([bytes]) as Readable&{receivedEncodedLength:number};stream.receivedEncodedLength=bytes.length;return stream;
}

async function fullSourceCompletionPreParsing(_request:FastifyRequest,_reply:FastifyReply,payload:NodeJS.ReadableStream){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of payload){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
    if(length>33554432)throw Object.assign(new Error("Превышен объём результата большого аудита"),{statusCode:413});chunks.push(bytes);}
  const bytes=Buffer.concat(chunks),read=parseDocumentTextV4FullCompletion(bytes);
  if(read.status!=="VALID")throw Object.assign(new Error(read.reasonCode==="INPUT_LIMIT"?"Превышены пределы результата большого аудита":"Некорректный JSON результата большого аудита"),{statusCode:read.reasonCode==="INPUT_LIMIT"?413:400});
  const stream=Readable.from([bytes]) as Readable&{receivedEncodedLength:number};stream.receivedEncodedLength=bytes.length;return stream;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const store: InspectionRepository = options.repository ?? options.store ?? (await InspectorStore.create());
  const storage = options.storage ?? createObjectStorageFromEnv();
  const malwareScanner = options.malwareScanner ?? createMalwareScannerFromEnv();
  const identity = options.identityService;
  const secureCookies = options.sessionCookieSecure ?? false;
  const workerToken = options.workerToken;
  const maxFileBytes = Math.min(options.maxFileBytes ?? uploadPolicy.maxFileBytes, uploadPolicy.maxFileBytes);
  const maxUploadBytes = Math.min(options.maxUploadBytes ?? uploadPolicy.maxUploadBytes, uploadPolicy.maxUploadBytes);

  await app.register(cookie);
  await app.register(cors, {
    origin: options.allowedOrigins ?? ["http://localhost:5173", "http://localhost:8080"],
    credentials: true,
    allowedHeaders: ["Content-Type", "If-Match", "Idempotency-Key", "X-CSRF-Token"],
    exposedHeaders: ["ETag", "Idempotency-Replayed", "X-Content-SHA256", "X-Protocol-Snapshot-SHA256", "X-Protocol-Template-Version", "X-Protocol-Validity"],
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: maxFileBytes,
      files: uploadPolicy.maxFiles,
      fields: 10,
      parts: uploadPolicy.maxFiles + 10,
    },
  });
  const inventoryRequests=new Set<AbortController>();
  app.addHook("onClose",async()=>{for(const controller of inventoryRequests)controller.abort();});
  async function inventoryRequest<T>(request:FastifyRequest,reply:FastifyReply,operation:(signal:AbortSignal)=>Promise<T>|T):Promise<T>{
    const controller=new AbortController();inventoryRequests.add(controller);
    const aborted=()=>controller.abort();
    const closed=()=>{if(!reply.raw.writableFinished)controller.abort();};
    request.raw.once("aborted",aborted);reply.raw.once("close",closed);
    if(request.raw.aborted)controller.abort();
    try{return await operation(controller.signal);}finally{
      request.raw.removeListener("aborted",aborted);reply.raw.removeListener("close",closed);inventoryRequests.delete(controller);
    }
  }
  if (store.close) app.addHook("onClose", async () => store.close?.());
  if (identity) app.addHook("onClose", async () => identity.close());
  if (options.localRegistrationService) app.addHook("onClose", async () => options.localRegistrationService!.close());

  const requireActor = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedActor | undefined> => {
    if (!identity) {
      reply.status(503).send({ error: "IDENTITY_UNAVAILABLE", message: "Identity adapter не настроен" });
      return undefined;
    }
    const sessionToken = request.cookies[SESSION_COOKIE];
    const actor = sessionToken ? await identity.resolveSession(sessionToken) : undefined;
    if (!actor) {
      reply.status(401).send({ error: "AUTH_REQUIRED", message: "Сессия отсутствует или истекла" });
      return undefined;
    }
    return actor;
  };

  const verifyCsrf = (
    request: FastifyRequest,
    reply: FastifyReply,
    actor: AuthenticatedActor,
  ): boolean => {
    const header = request.headers["x-csrf-token"];
    const cookieToken = request.cookies[CSRF_COOKIE];
    if (
      !identity
      || typeof header !== "string"
      || !cookieToken
      || header !== cookieToken
      || !identity.verifyCsrf(actor, header)
    ) {
      reply.status(403).send({ error: "CSRF_INVALID", message: "CSRF-токен отсутствует или неверен" });
      return false;
    }
    return true;
  };

  const requireIdempotencyKey = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | undefined => {
    const value = request.headers["idempotency-key"];
    if (typeof value !== "string") {
      reply.status(428).send({
        error: "PRECONDITION_REQUIRED",
        message: "Для команды нужен заголовок Idempotency-Key",
      });
      return undefined;
    }
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
      reply.status(400).send({ error: "INVALID_IDEMPOTENCY_KEY", message: "Некорректный Idempotency-Key" });
      return undefined;
    }
    return value;
  };

  const auditedCommand = (
    request: FastifyRequest,
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ) => ({
    actor,
    idempotencyKey,
    requestId: request.id,
    traceId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.slice(0, 1000),
  });

  registerLocalRegistrationRoutes(app, { service: options.localRegistrationService, storage,
    requireActor, verifyCsrf, requireIdempotencyKey, auditedCommand });
  registerDocumentCoordinateRoutes(app, { service: options.localRegistrationService, storage, requireActor, verifyCsrf });
  registerDrainageSourceRoutes(app, { service: options.localRegistrationService, requireActor, verifyCsrf });
  registerPpm113SourceRoutes(app, { service: options.localRegistrationService, requireActor, verifyCsrf });
  registerColumnPylonSectionV2Routes(app, { repository: store, requireActor, verifyCsrf, requireIdempotencyKey, auditedCommand });

  const resolveScopedRead = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    read: (actor?: AuthenticatedActor) => ScopedReadResult<T> | Promise<ScopedReadResult<T>>,
  ): Promise<{ value: T | undefined; actor?: AuthenticatedActor } | undefined> => {
    let value = await read();
    if (value !== "AUTH_REQUIRED") return { value };
    const actor = await requireActor(request, reply);
    if (!actor) return undefined;
    value = await read(actor);
    if (value === "AUTH_REQUIRED") {
      throw new Error("Repository requested identity after an authenticated scoped read");
    }
    return { value, actor };
  };

  const requireWorker = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!workerToken) {
      reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Worker control plane не настроен" });
      return false;
    }
    const supplied = request.headers["x-worker-token"];
    if (typeof supplied !== "string") {
      reply.status(401).send({ error: "WORKER_AUTH_REQUIRED", message: "Worker token отсутствует или неверен" });
      return false;
    }
    const expectedBytes = Buffer.from(workerToken);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      reply.status(401).send({ error: "WORKER_AUTH_REQUIRED", message: "Worker token отсутствует или неверен" });
      return false;
    }
    return true;
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ColumnPylonSectionWireError) return reply.status(error.code === "INPUT_LIMIT" ? 413 : 400)
      .send({ error: `KR060_${error.code}`, message: "Некорректное решение пары сечений или превышен его объём" });
    if(error instanceof SteelApplicabilityReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`STEEL_APPLICABILITY_${error.code}`,message:error.message});
    if(error instanceof RailInventoryReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`RAIL_INVENTORY_${error.code}`,message:error.message});
    if(error instanceof WaterNodeReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`WATER_NODE_${error.code}`,message:error.message});
    if(error instanceof SteelComparisonReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`STEEL_COMPARISON_${error.code}`,message:error.message});
    if(error instanceof LightingTechnologyReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`LIGHTING_TECHNOLOGY_${error.code}`,message:error.message});
    if(error instanceof CallInventoryReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:`CALL_INVENTORY_${error.code}`,message:error.message});
    if(error instanceof InventoryReviewValidationError)return reply.status(error.code==="INPUT_LIMIT"?413:400).send({error:(error.code.startsWith("INVENTORY_")?error.code:`INVENTORY_${error.code}`),message:error.message});
    if (error instanceof FileIngestError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Проверьте обязательные поля",
        details: error.issues,
      });
    }
    const validation = error && typeof error === "object" && "validation" in error
      ? (error as { validation?: unknown }).validation
      : undefined;
    if (Array.isArray(validation)) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Проверьте обязательные поля",
        details: validation,
      });
    }
    if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
      return reply.status(413).send({ error: "FILE_TOO_LARGE", message: "Файл превышает допустимый размер" });
    }
    const clientStatus = (error as { statusCode?: number }).statusCode;
    if (clientStatus && clientStatus >= 400 && clientStatus < 500) {
      const message = error instanceof Error ? error.message : "Некорректная загрузка";
      return reply.status(clientStatus).send({
        error: clientStatus === 429 ? "RATE_LIMITED" : "INVALID_REQUEST",
        message,
      });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "Внутренняя ошибка сервиса" });
  });

  app.get("/api/health", { schema: fastifySchemaFor("getHealth") }, async () => ({
    status: "ok",
    service: "inspector-ai-api",
  }));
  app.get("/api/openapi.json", { schema: fastifySchemaFor("getOpenApi") }, async () => openApiDocument);

  app.post<{ Params: { id: string }; Body: JobClaimInput }>(
    "/api/internal/v1/jobs/:id/claim",
    { schema: fastifySchemaFor("claimJob") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.claimJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await store.claimJob(request.params.id, request.body);
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "capability_mismatch") {
        return reply.status(409).send({
          error: "CAPABILITY_MISMATCH",
          message: `Worker не поддерживает ${result.requiredCapability}`,
        });
      }
      if (result.kind === "queue_mismatch") {
        return reply.status(409).send({
          error: "QUEUE_MISMATCH",
          message: "Worker подключён к другой очереди",
        });
      }
      if (result.kind === "acquired") return { status: "ACQUIRED", lease: result.lease };
      if (result.kind === "not_ready") return { status: "NOT_READY", state: result.state };
      return { status: "ALREADY_TERMINAL", state: result.state };
    },
  );
  app.post<{ Params: { id: string }; Body: JobAttemptInput }>(
    "/api/internal/v1/jobs/:id/heartbeat",
    { schema: fastifySchemaFor("heartbeatJob") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.heartbeatJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await store.heartbeatJob(request.params.id, request.body);
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "extended") return { status: "LEASE_EXTENDED", leaseUntil: result.leaseUntil };
      return { status: "ALREADY_TERMINAL", state: result.state };
    },
  );
  app.get<{
    Params: { id: string; sourceFileId: string };
    Querystring: JobAttemptInput;
  }>(
    "/api/internal/v1/jobs/:id/inputs/:sourceFileId",
    { schema: fastifySchemaFor("downloadJobInput") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.getJobInput) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Job inputs не поддерживаются" });
      }
      const result = await store.getJobInput(request.params.id, request.params.sourceFileId, request.query);
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Job input не найден" });
      }
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "already_terminal") {
        return reply.status(409).send({ error: "JOB_TERMINAL", message: `Job уже завершён: ${result.state}` });
      }
      try {
        const stored = await storage.getFile(result.file.storageKey);
        if (stored.size !== result.file.byteSize) {
          stored.body.destroy();
          request.log.error({
            jobId: request.params.id,
            sourceFileId: request.params.sourceFileId,
            expectedSize: result.file.byteSize,
            storedSize: stored.size,
          }, "job input storage size mismatch");
          return reply.status(503).send({ error: "STORAGE_INTEGRITY_ERROR", message: "Размер входного файла не совпадает" });
        }
        reply.header("Content-Length", String(result.file.byteSize));
        reply.header("X-Content-SHA256", result.file.sha256);
        reply.header("Cache-Control", "private, no-store");
        return reply.type(result.file.mediaType || stored.contentType || "application/octet-stream").send(stored.body);
      } catch (error) {
        request.log.error({
          err: error,
          jobId: request.params.id,
          sourceFileId: request.params.sourceFileId,
        }, "job input storage read failed");
        return reply.status(503).send({ error: "STORAGE_UNAVAILABLE", message: "Входной файл временно недоступен" });
      }
    },
  );
  app.get<{
    Params: { id: string; sourceFileId: string };
    Querystring: JobAttemptInput;
  }>(
    "/api/internal/v1/jobs/:id/text-artifacts/:sourceFileId",
    { schema: fastifySchemaFor("downloadJobTextArtifact") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.getJobTextArtifact) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Text artifacts не поддерживаются" });
      }
      const result = await store.getJobTextArtifact(request.params.id, request.params.sourceFileId, request.query);
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Text artifact не найден" });
      }
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "already_terminal") {
        return reply.status(409).send({ error: "JOB_TERMINAL", message: `Job уже завершён: ${result.state}` });
      }
      if (result.kind === "integrity_error") {
        request.log.error({ jobId: request.params.id, sourceFileId: request.params.sourceFileId }, "text artifact integrity mismatch");
        return reply.status(503).send({ error: "ARTIFACT_INTEGRITY_ERROR", message: "Text artifact повреждён" });
      }
      reply.header("Content-Length", String(result.byteSize));
      reply.header("X-Content-SHA256", result.contentHash);
      reply.header("X-Input-SHA256", result.inputSha256);
      reply.header("X-Artifact-Schema-Version", result.schemaVersion);
      reply.header("Cache-Control", "private, no-store");
      return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical, "utf8"));
    },
  );
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/water-node-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobWaterNodeReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobWaterNodeReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobWaterNodeReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/steel-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobSteelReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobSteelReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobSteelReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/column-pylon-section-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobColumnPylonSectionReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobColumnPylonSectionReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobColumnPylonSectionReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/concrete-wall-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobConcreteWallReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobConcreteWallReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobConcreteWallReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/lighting-technology-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobLightingTechnologyReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobLightingTechnologyReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobLightingTechnologyReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{Params:{id:string};Querystring:JobAttemptInput}>(
    "/api/internal/v1/jobs/:id/rail-reviewed-inventory-comparison-inputs",
    {schema:fastifySchemaFor("downloadJobRailReviewedInventoryComparisonInputs"),preValidation:async(request,reply)=>{
      const names=[...new URL(request.raw.url??"/","http://internal.invalid").searchParams.keys()];
      if(names.length!==2||new Set(names).size!==2||names.some(name=>name!=="attemptId"&&name!=="fencingToken"))
        return reply.status(400).send({error:"INVALID_INPUT",message:"Требуются только attemptId и fencingToken"});
    }},
    async(request,reply)=>{
      if(!requireWorker(request,reply))return;
      if(!store.getJobRailReviewedInventoryComparisonInputs)return reply.status(503).send({error:"WORKER_CONTROL_UNAVAILABLE",message:"Inventory inputs недоступны"});
      const result=await inventoryRequest(request,reply,signal=>store.getJobRailReviewedInventoryComparisonInputs!(request.params.id,request.query,{signal}));
      if(result.kind==="not_found")return reply.status(404).send({error:"NOT_FOUND",message:"Inventory inputs отсутствуют"});
      if(result.kind==="stale_attempt")return reply.status(409).send({error:"STALE_ATTEMPT",message:"Attempt или fencing token устарел"});
      if(result.kind==="already_terminal")return reply.status(409).send({error:"JOB_TERMINAL",message:"Job уже завершён"});
      if(result.kind==="integrity_error")return reply.status(503).send({error:"ARTIFACT_INTEGRITY_ERROR",message:"Исходные данные не прошли проверку целостности"});
      reply.header("Content-Length",String(result.byteSize));reply.header("X-Content-SHA256",result.contentHash);
      reply.header("X-Artifact-Schema-Version",result.schemaVersion);reply.header("X-Input-Manifest-SHA256",result.inputManifestHash);
      reply.header("Cache-Control","private, no-store");return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical,"utf8"));
    });
  app.get<{ Params: { id: string }; Querystring: JobAttemptInput }>(
    "/api/internal/v1/jobs/:id/ocr-layout-artifact",
    { schema: fastifySchemaFor("downloadJobOcrLayoutArtifact") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.getJobOcrLayoutArtifact) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "OCR layout artifact не поддерживается" });
      }
      const result = await store.getJobOcrLayoutArtifact(request.params.id, request.query);
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "OCR layout artifact не найден" });
      }
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "already_terminal") {
        return reply.status(409).send({ error: "JOB_TERMINAL", message: `Job уже завершён: ${result.state}` });
      }
      if (result.kind === "integrity_error") {
        request.log.error({ jobId: request.params.id }, "OCR layout artifact integrity mismatch");
        return reply.status(503).send({ error: "ARTIFACT_INTEGRITY_ERROR", message: "OCR layout artifact повреждён" });
      }
      reply.header("Content-Length", String(result.byteSize));
      reply.header("X-Content-SHA256", result.contentHash);
      reply.header("X-Input-Manifest-SHA256", result.inputManifestHash);
      reply.header("X-Artifact-Schema-Version", result.schemaVersion);
      reply.header("X-Provider-Profile-Id", result.providerProfileId);
      reply.header("X-Provider-Config-SHA256", result.providerConfigHash);
      reply.header("Cache-Control", "private, no-store");
      return reply.type("application/json; charset=utf-8").send(Buffer.from(result.canonical, "utf8"));
    },
  );
  app.post<{ Params: { id: string }; Body: JobCompleteInput }>(
    "/api/internal/v1/jobs/:id/complete",
    { schema: fastifySchemaFor("completeJob"), bodyLimit: 10 * 1024 * 1024 },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.completeJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await inventoryRequest(request,reply,signal=>store.completeJob!(request.params.id, request.body,{signal}));
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.kind === "already_terminal") return { status: "ALREADY_TERMINAL", state: result.state };
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return { status: "COMPLETED", check: result.check, replayed: result.replayed };
    },
  );
  app.post<{ Params: { id: string }; Body: JobCompleteInput }>(
    "/api/internal/v1/jobs/:id/complete-source-audit-v3-large-v1",
    { schema: fastifySchemaFor("completeSourceAuditV3Large"), bodyLimit: 33554432, preParsing: largeSourceCompletionPreParsing,
      onRequest: async(request,reply)=>{if(!requireWorker(request,reply))return reply;} },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.completeJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await inventoryRequest(request,reply,signal=>store.completeJob!(request.params.id, request.body,{signal,sourceAuditProfileVersion:"SOURCE_AUDIT_V3_LARGE_VERTICAL_V1"}));
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.kind === "already_terminal") return { status: "ALREADY_TERMINAL", state: result.state };
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return { status: "COMPLETED", check: result.check, replayed: result.replayed };
    },
  );
  app.post<{ Params: { id: string }; Body: JobCompleteInput }>(
    "/api/internal/v1/jobs/:id/complete-source-audit-v4-full-source-v1",
    { schema: fastifySchemaFor("completeSourceAuditV4Full"), bodyLimit: 33554432, preParsing: fullSourceCompletionPreParsing,
      onRequest: async(request,reply)=>{if(!requireWorker(request,reply))return reply;} },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.completeJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await inventoryRequest(request,reply,signal=>store.completeJob!(request.params.id, request.body,{signal,sourceAuditProfileVersion:"SOURCE_AUDIT_V4_FULL_SOURCE_V1"}));
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.kind === "already_terminal") return { status: "ALREADY_TERMINAL", state: result.state };
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return { status: "COMPLETED", check: result.check, replayed: result.replayed };
    },
  );
  app.post<{ Params: { id: string }; Body: JobFailInput }>(
    "/api/internal/v1/jobs/:id/fail",
    { schema: fastifySchemaFor("failJob") },
    async (request, reply) => {
      if (!requireWorker(request, reply)) return;
      if (!store.failJob) {
        return reply.status(503).send({ error: "WORKER_CONTROL_UNAVAILABLE", message: "Durable jobs не поддерживаются" });
      }
      const result = await store.failJob(request.params.id, request.body);
      if (result.kind === "not_found") return reply.status(404).send({ error: "NOT_FOUND", message: "Job не найден" });
      if (result.kind === "stale_attempt") {
        return reply.status(409).send({ error: "STALE_ATTEMPT", message: "Attempt или fencing token устарел" });
      }
      if (result.kind === "already_terminal") return { status: "ALREADY_TERMINAL", state: result.state };
      if (result.kind === "retry_scheduled") {
        return { status: "RETRY_SCHEDULED", nextAttemptAt: result.nextAttemptAt };
      }
      return { status: "FAILED" };
    },
  );

  app.post(
    "/api/auth/login",
    {
      schema: fastifySchemaFor("login"),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (options.openWorkspace) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Вход по паролю отключён" });
      }
      if (!identity) {
        return reply.status(503).send({ error: "IDENTITY_UNAVAILABLE", message: "Identity adapter не настроен" });
      }
      const input = loginSchema.parse(request.body);
      const result = await identity.login(input.login, input.password);
      if (!result) {
        return reply.status(401).send({ error: "INVALID_CREDENTIALS", message: "Неверный логин или пароль" });
      }
      const expires = new Date(result.actor.expiresAt);
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "strict",
        path: "/api",
        expires,
      });
      reply.setCookie(CSRF_COOKIE, result.csrfToken, {
        httpOnly: false,
        secure: secureCookies,
        sameSite: "strict",
        path: "/",
        expires,
      });
      reply.header("Cache-Control", "no-store");
      return sessionResponse(result.actor);
    },
  );
  app.post(
    "/api/auth/open-workspace",
    { schema: fastifySchemaFor("createOpenWorkspaceSession"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      if (!options.openWorkspace || !identity?.createOpenWorkspaceSession) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Открытый рабочий контур не настроен" });
      }
      const result = await identity.createOpenWorkspaceSession();
      if (!result) {
        return reply.status(503).send({ error: "OPEN_WORKSPACE_UNAVAILABLE", message: "Рабочий контур не готов" });
      }
      const expires = new Date(result.actor.expiresAt);
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/api", expires,
      });
      reply.setCookie(CSRF_COOKIE, result.csrfToken, {
        httpOnly: false, secure: secureCookies, sameSite: "strict", path: "/", expires,
      });
      reply.header("Cache-Control", "no-store");
      return sessionResponse(result.actor);
    },
  );
  app.post(
    "/api/auth/public-visitor",
    { schema: fastifySchemaFor("createPublicVisitorSession"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!identity?.createPublicVisitorSession || options.publicReviewObjectIds?.length !== 3) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Публичный просмотр не настроен" });
      }
      const existingToken = request.cookies[SESSION_COOKIE];
      const existing = existingToken ? await identity.resolveSession(existingToken) : undefined;
      if (existing) {
        reply.header("Cache-Control", "no-store");
        return sessionResponse(existing);
      }
      const result = await identity.createPublicVisitorSession(options.publicReviewObjectIds);
      if (!result) {
        return reply.status(503).send({ error: "PUBLIC_EXAMPLES_UNAVAILABLE", message: "Публичные примеры ещё не подготовлены" });
      }
      const expires = new Date(result.actor.expiresAt);
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/api", expires,
      });
      reply.setCookie(CSRF_COOKIE, result.csrfToken, {
        httpOnly: false, secure: secureCookies, sameSite: "strict", path: "/", expires,
      });
      reply.header("Cache-Control", "no-store");
      return sessionResponse(result.actor);
    },
  );
  app.get("/api/auth/session", { schema: fastifySchemaFor("getSession") }, async (request, reply) => {
    const actor = await requireActor(request, reply);
    if (!actor) return;
    reply.header("Cache-Control", "no-store");
    return sessionResponse(actor);
  });
  app.post("/api/auth/logout", { schema: fastifySchemaFor("logout") }, async (request, reply) => {
    const actor = await requireActor(request, reply);
    if (!actor || !verifyCsrf(request, reply, actor)) return;
    await identity!.revokeSession(actor.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/api" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    reply.header("Cache-Control", "no-store");
    return { revoked: true };
  });

  app.get("/api/objects", { schema: fastifySchemaFor("listObjects") }, async (request, reply) => {
    let actor: AuthenticatedActor | undefined;
    if (request.cookies[SESSION_COOKIE]) {
      actor = await requireActor(request, reply);
      if (!actor) return;
    }
    return { items: await store.listObjects(actor) };
  });
  app.post("/api/objects", { schema: fastifySchemaFor("createObject") }, async (request, reply) => {
    let actor: AuthenticatedActor | undefined;
    let idempotencyKey: string | undefined;
    if (identity) {
      actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!canOperateInspection(actor, "OBJECT_CREATE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права создавать объекты" });
      }
      idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
    }
    const input = createObjectSchema.parse(request.body);
    if (actor && idempotencyKey) {
      if (!store.createObjectCommand) {
        return reply.status(503).send({
          error: "COMMAND_RECEIPTS_UNAVAILABLE",
          message: "Хранилище не поддерживает надёжное создание объектов",
        });
      }
      const result = await store.createObjectCommand(input, auditedCommand(request, actor, idempotencyKey));
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency-Key уже использован для другой команды",
        });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права создавать объекты" });
      }
      if (result.kind !== "success") {
        return reply.status(409).send({ error: result.kind, message: "Объект создать не удалось" });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return reply.status(201).send(result.value);
    }
    return reply.status(201).send(await store.createObject(input, actor));
  });
  app.get<{ Params: { id: string } }>(
    "/api/objects/:id",
    { schema: fastifySchemaFor("getObject") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getObject(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
      return resolved.actor ? { ...resolved.value, ...await readObjectPermissions(store, resolved.value, resolved.actor) } : resolved.value;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/objects/:id/files",
    { schema: fastifySchemaFor("listSourceFiles") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.listSourceFiles) {
        return reply.status(503).send({ error: "SOURCE_FILES_UNAVAILABLE", message: "Список исходных файлов недоступен" });
      }
      const files = await store.listSourceFiles(request.params.id, actor);
      if (!files || files === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
      }
      const object = await store.getObject(request.params.id, actor);
      if (!object || object === "AUTH_REQUIRED") return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
      const access = await readObjectPermissions(store, object, actor);
      return {
        items: files,
        inspectionLifecycle: access.inspectionLifecycle,
        ...(access.readOnlyReason ? { readOnlyReason: access.readOnlyReason } : {}),
        permissions: {
          upload: access.permissions.upload,
          review: access.permissions.review,
          run: access.permissions.run,
        },
      };
    },
  );
  app.get<{ Params: { id: string; sourceFileId: string } }>(
    "/api/objects/:id/files/:sourceFileId/content",
    { schema: fastifySchemaFor("downloadSourceFile") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getSourceFileContent) {
        return reply.status(503).send({ error: "SOURCE_FILES_UNAVAILABLE", message: "Исходные файлы недоступны" });
      }
      const file = await store.getSourceFileContent(request.params.id, request.params.sourceFileId, actor);
      if (!file || file === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Исходный файл не найден" });
      }
      try {
        const stored = await storage.getFile(file.storageKey);
        if (stored.size !== file.byteSize) {
          stored.body.destroy();
          return reply.status(503).send({ error: "STORAGE_INTEGRITY_ERROR", message: "Размер исходного файла не совпал" });
        }
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "source";
        reply.header("Content-Disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        reply.header("Content-Length", String(file.byteSize));
        reply.header("X-Content-SHA256", file.sha256);
        reply.header("Cache-Control", "private, no-store");
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.type(file.mediaType || "application/octet-stream").send(stored.body);
      } catch (error) {
        request.log.error({ err: error, sourceFileId: request.params.sourceFileId }, "source storage read failed");
        return reply.status(503).send({ error: "STORAGE_UNAVAILABLE", message: "Исходный файл временно недоступен" });
      }
    },
  );
  app.get<{ Params: { id: string; sourceFileId: string; registrationId: string } }>(
    "/api/objects/:id/files/:sourceFileId/geometry-registrations/:registrationId",
    { schema: fastifySchemaFor("getGeometryRegistration") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      const file = await store.getSourceFileContent?.(request.params.id, request.params.sourceFileId, actor);
      if (!file || file === "AUTH_REQUIRED") return reply.status(404).send({ error: "NOT_FOUND", message: "Источник недоступен" });
      if (!process.env.GEOMETRY_TRUST_STORE) return reply.status(503).send({ error: "TRUSTED_CONTROL_SOURCE_UNAVAILABLE",
        message: "Независимый источник контрольных точек не настроен; положение здания не установлено" });
      try {
        const sourceBytes = await readVerifiedOriginalPdf({ storage, storageKey: file.storageKey,
          expectedSha256: file.sha256, expectedByteSize: file.byteSize, expectedMediaType: "application/pdf" });
        const result = await loadTrustedGeometryRegistration({ directory: process.env.GEOMETRY_TRUST_STORE,
          registrationId: request.params.registrationId, organizationId: actor.organizationId,
          objectId: request.params.id, sourceFileId: request.params.sourceFileId, sourceSha256: file.sha256, sourceBytes });
        reply.header("Cache-Control", "private, no-store");
        return result;
      } catch {
        return reply.status(422).send({ error: "GEOMETRY_REGISTRATION_UNVERIFIED",
          message: "Не подтверждены подпись, происхождение, исходный SHA или ошибка геопривязки; предметный вывод недоступен" });
      }
    },
  );
  app.get<{ Params: { id: string; sourceFileId: string; pageNumber: string }; Querystring: { crop?: string; resolution?: number } }>(
    "/api/objects/:id/files/:sourceFileId/pages/:pageNumber/preview",
    { schema: fastifySchemaFor("previewSourcePdfPage") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!/^[1-9]\d{0,4}$/.test(request.params.pageNumber)
        || Number(request.params.pageNumber) > 10_000) {
        return reply.status(400).send({ error: "INVALID_PAGE", message: "Номер страницы вне допустимого диапазона" });
      }
      if (!store.getSourceFileContent) {
        return reply.status(503).send({ error: "SOURCE_FILES_UNAVAILABLE", message: "Исходные файлы недоступны" });
      }
      const file = await store.getSourceFileContent(request.params.id, request.params.sourceFileId, actor);
      if (!file || file === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Исходный файл не найден" });
      }
      if (file.mediaType !== "application/pdf") {
        return reply.status(415).send({ error: "UNSUPPORTED_FORMAT", message: "Просмотр страницы доступен только для PDF" });
      }
      try {
        const crop = parseNormalizedCrop(request.query.crop);
        const stored = await storage.getFile(file.storageKey);
        if (stored.size !== file.byteSize) {
          stored.body.destroy();
          return reply.status(503).send({ error: "STORAGE_INTEGRITY_ERROR", message: "Размер исходного файла не совпал" });
        }
        const image = await renderVerifiedPdfPage(stored.body, file, Number(request.params.pageNumber), crop, request.query.resolution ?? 1200);
        reply.header("Cache-Control", "private, no-store");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Content-Length", String(image.byteLength));
        return reply.type("image/png").send(image);
      } catch (error) {
        if (error instanceof PdfPreviewError) {
          return reply.status(error.status).send({ error: error.code, message: error.message });
        }
        request.log.error({ err: error, sourceFileId: request.params.sourceFileId }, "PDF page preview failed");
        return reply.status(503).send({ error: "PREVIEW_UNAVAILABLE", message: "Просмотр страницы временно недоступен" });
      }
    },
  );
  app.post<{ Params: { id: string }; Querystring: { stage?: string } }>(
    "/api/objects/:id/files",
    { schema: fastifySchemaFor("uploadObjectFiles") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getObject(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
      }
      if (resolved.actor && !verifyCsrf(request, reply, resolved.actor)) return;
      if (resolved.actor && !canOperateInspection(resolved.actor, "DOCUMENT_UPLOAD")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Роль не разрешает загрузку документов" });
      }
      if (
        resolved.actor
        && !(await store.hasObjectPermission(request.params.id, resolved.actor, "UPLOAD"))
      ) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права загружать документы объекта" });
      }
      const idempotencyKey = resolved.actor ? requireIdempotencyKey(request, reply) : undefined;
      if (resolved.actor && !idempotencyKey) return;
      if (resolved.value.inspectionLifecycle === "FINALIZED" || resolved.value.status === "FINALIZED")
        return reply.status(409).send({ error: "INSPECTION_FINALIZED", message: finalizedObjectReason });
      const stage = uploadStageSchema.parse(request.query.stage);
      if (!request.isMultipart()) {
        return reply.status(415).send({
          error: "MULTIPART_REQUIRED",
          message: "Документы нужно передать как multipart/form-data",
        });
      }
      const result = await ingestMultipartFiles({
        objectId: request.params.id,
        stage,
        parts: request.parts(),
        store,
        storage,
        maxUploadBytes,
        malwareScanner,
        actor: resolved.actor,
        command: resolved.actor && idempotencyKey
          ? auditedCommand(request, resolved.actor, idempotencyKey)
          : undefined,
      });
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return reply.status(201).send(result.upload);
    },
  );
  app.get<{Params:{id:string}}>("/api/objects/:id/steel-applicability-reviews",
    {schema:fastifySchemaFor('getSteelApplicabilityReviews')},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      if(!store.getSteelApplicabilityReviews)return reply.status(503).send({error:'STEEL_APPLICABILITY_UNAVAILABLE',message:'Хранилище решений недоступно'});
      const result=await store.getSteelApplicabilityReviews(request.params.id,actor);
      if(!result)return reply.status(404).send({error:'NOT_FOUND',message:'Объект или проверенный журнал не найден'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.post<{Params:{id:string}}>("/api/objects/:id/steel-applicability-reviews",
    {schema:fastifySchemaFor('recordSteelApplicabilityReview'),bodyLimit:524288,preParsing:steelApplicabilityReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      if(!actor.capabilities.includes('SOURCE_REVIEW')||!(await store.hasObjectPermission(request.params.id,actor,'REVIEW_DECIDE')))
        return reply.status(403).send({error:'FORBIDDEN',message:'Нет права оценивать применимость пары'});
      const idempotencyKey=requireIdempotencyKey(request,reply);if(!idempotencyKey)return;
      if(!store.recordSteelApplicabilityReviewCommand)return reply.status(503).send({error:'STEEL_APPLICABILITY_UNAVAILABLE',message:'Хранилище решений недоступно'});
      const input=parseSteelApplicabilityReviewInput(request.body);
      const result=await store.recordSteelApplicabilityReviewCommand(request.params.id,input,auditedCommand(request,actor,idempotencyKey));
      if(result.kind==='not_found')return reply.status(404).send({error:'NOT_FOUND',message:'Объект не найден либо недоступен'});
      if(result.kind==='forbidden')return reply.status(403).send({error:'FORBIDDEN',message:'Нет права оценивать применимость пары'});
      if(result.kind==='idempotency_conflict')return reply.status(409).send({error:'IDEMPOTENCY_CONFLICT',message:'Ключ повтора уже использован'});
      if(result.kind==='invalid_state')return reply.status(409).send({error:result.code,message:result.message});
      if(result.replayed)reply.header('Idempotency-Replayed','true');return reply.status(201).send(result.value);
    });
  app.post<{ Params: { id: string; sourceFileId: string } }>(
    "/api/objects/:id/files/:sourceFileId/source-review",
    { schema: fastifySchemaFor("recordSourceReview"),bodyLimit:524288,preParsing:inventoryReviewPreParsing },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("SOURCE_REVIEW")
        || !(await store.hasObjectPermission(request.params.id, actor, "REVIEW_DECIDE"))) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права оценивать источник" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordSourceReviewCommand) {
        return reply.status(503).send({ error: "SOURCE_REVIEW_UNAVAILABLE", message: "Хранилище решений недоступно" });
      }
      assertInventoryReviewNative(request.body);
      const input = sourceReviewSchema.parse(request.body);
      const result = await store.recordSourceReviewCommand(
        request.params.id, request.params.sourceFileId, input,
        auditedCommand(request, actor, idempotencyKey),
      );
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Исходный файл не найден" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права оценивать источник" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string; sourceFileId: string } }>(
    "/api/objects/:id/files/:sourceFileId/source-review",
    { schema: fastifySchemaFor("getSourceReview") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getSourceReview) {
        return reply.status(503).send({ error: "SOURCE_REVIEW_UNAVAILABLE", message: "Хранилище решений недоступно" });
      }
      const result = await store.getSourceReview(request.params.id, request.params.sourceFileId, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Решение не найдено" });
      }
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/uploads/:id",
    { schema: fastifySchemaFor("getUpload") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getUpload(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Загрузка не найдена" });
      return resolved.value;
    },
  );
  app.get<{ Params: { id: string } }>("/api/objects/:id/checks", { schema: fastifySchemaFor("listObjectChecks") }, async (request, reply) => {
    const actor = await requireActor(request, reply);
    if (!actor) return;
    const items = await store.listObjectChecks?.(request.params.id, actor);
    if (!items || items === "AUTH_REQUIRED") return reply.status(404).send({ error: "NOT_FOUND", message: "История проверок недоступна" });
    return { items };
  });
  app.post<{ Params: { id: string }; Body: { analysisMode?: "SAMPLE" | "FULL" } | undefined }>(
    "/api/objects/:id/checks",
    { schema: fastifySchemaFor("startCheck") },
    async (request, reply) => {
      if (request.body !== undefined && (!request.body || typeof request.body !== "object"
        || Array.isArray(request.body) || Object.keys(request.body).some(key => key !== "analysisMode")
        || (request.body.analysisMode !== undefined && !["SAMPLE", "FULL"].includes(request.body.analysisMode))))
        return reply.status(400).send({ error: "INVALID_ANALYSIS_MODE", message: "Выберите SAMPLE или FULL" });
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getObject(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
      if (resolved.actor && !verifyCsrf(request, reply, resolved.actor)) return;
      if (resolved.actor && !canOperateInspection(resolved.actor, "RUN_START")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Роль не разрешает запуск проверки" });
      }
      if (
        resolved.actor
        && !(await store.hasObjectPermission(request.params.id, resolved.actor, "RUN"))
      ) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права запускать проверку объекта" });
      }
      const idempotencyKey = resolved.actor ? requireIdempotencyKey(request, reply) : undefined;
      if (resolved.actor && !idempotencyKey) return;
      if (resolved.value.fileCount === 0) {
        return reply.status(409).send({
          error: "DOCUMENTS_REQUIRED",
          message: "Перед запуском проверки загрузите хотя бы один документ",
        });
      }
      let check: CheckRun | undefined;
      if (resolved.actor && idempotencyKey) {
        if (!store.startCheckCommand) {
          return reply.status(503).send({
            error: "COMMAND_RECEIPTS_UNAVAILABLE",
            message: "Хранилище не поддерживает надёжный запуск проверки",
          });
        }
        const result = await store.startCheckCommand(
          request.params.id,
          auditedCommand(request, resolved.actor, idempotencyKey),
          request.body?.analysisMode ? { analysisMode: request.body.analysisMode } : undefined,
        );
        if (result.kind === "idempotency_conflict") {
          return reply.status(409).send({
            error: "IDEMPOTENCY_CONFLICT",
            message: "Idempotency-Key уже использован для другой команды",
          });
        }
        if (result.kind === "forbidden") {
          return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права запускать проверку объекта" });
        }
        if (result.kind === "not_found") {
          return reply.status(404).send({ error: "NOT_FOUND", message: "Объект не найден" });
        }
        if (result.kind === "invalid_state") {
          return reply.status(409).send({ error: result.code, message: result.message });
        }
        if (result.replayed) reply.header("Idempotency-Replayed", "true");
        check = result.value;
      } else {
        check = await store.startCheck(request.params.id, resolved.actor);
      }
      if (!check) return reply.status(500).send({ error: "INTERNAL_ERROR", message: "Не удалось создать проверку" });
      const result = check.mode === "DEMO_SEED" || !store.completeJob
        ? await store.completeCheck(check.id)
        : check;
      return reply.status(201).send(result);
    },
  );
  app.post<{Params:{id:string}}>('/api/objects/:id/source-audit-v3',
    {schema:fastifySchemaFor('startSourceAuditV3'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      z.object({}).strict().parse(request.body);
      if(!canOperateInspection(actor,'RUN_START'))return reply.status(403).send({error:'FORBIDDEN',message:'Роль не разрешает запуск проверки'});
      if(!await store.hasObjectPermission(request.params.id,actor,'RUN'))return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      const idempotencyKey=requireIdempotencyKey(request,reply);if(!idempotencyKey)return;
      if(!store.startCheckCommand)return reply.status(503).send({error:'COMMAND_RECEIPTS_UNAVAILABLE',message:'Надёжный запуск недоступен'});
      const result=await store.startCheckCommand(request.params.id,auditedCommand(request,actor,idempotencyKey),{sourceAuditV3:true});
      if(result.kind==='idempotency_conflict')return reply.status(409).send({error:'IDEMPOTENCY_CONFLICT',message:'Idempotency-Key уже использован для другой команды'});
      if(result.kind==='forbidden')return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      if(result.kind==='not_found')return reply.status(404).send({error:'NOT_FOUND',message:'Объект не найден'});
      if(result.kind==='invalid_state')return reply.status(409).send({error:result.code,message:result.message});
      if(result.replayed)reply.header('Idempotency-Replayed','true');
      reply.header('Cache-Control','private, no-store');return reply.status(201).send(result.value);
    });
  app.post<{Params:{id:string}}>('/api/objects/:id/source-audit-v3-large-vertical-v1',
    {schema:fastifySchemaFor('startSourceAuditV3LargeVertical'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      z.object({}).strict().parse(request.body);
      if(!canOperateInspection(actor,'RUN_START'))return reply.status(403).send({error:'FORBIDDEN',message:'Роль не разрешает запуск проверки'});
      if(!await store.hasObjectPermission(request.params.id,actor,'RUN'))return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      const idempotencyKey=requireIdempotencyKey(request,reply);if(!idempotencyKey)return;
      if(!store.startCheckCommand)return reply.status(503).send({error:'COMMAND_RECEIPTS_UNAVAILABLE',message:'Надёжный запуск недоступен'});
      const result=await store.startCheckCommand(request.params.id,auditedCommand(request,actor,idempotencyKey),{sourceAuditV3Large:true});
      if(result.kind==='idempotency_conflict')return reply.status(409).send({error:'IDEMPOTENCY_CONFLICT',message:'Idempotency-Key уже использован для другой команды'});
      if(result.kind==='forbidden')return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      if(result.kind==='not_found')return reply.status(404).send({error:'NOT_FOUND',message:'Объект не найден'});
      if(result.kind==='invalid_state')return reply.status(409).send({error:result.code,message:result.message});
      if(result.replayed)reply.header('Idempotency-Replayed','true');
      reply.header('Cache-Control','private, no-store');return reply.status(201).send(result.value);
    });
  app.post<{Params:{id:string}}>('/api/objects/:id/source-audit-v4-full-source-v1',
    {schema:fastifySchemaFor('startSourceAuditV4FullSource'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      z.object({}).strict().parse(request.body);
      if(!canOperateInspection(actor,'RUN_START'))return reply.status(403).send({error:'FORBIDDEN',message:'Роль не разрешает запуск проверки'});
      if(!await store.hasObjectPermission(request.params.id,actor,'RUN'))return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      const idempotencyKey=requireIdempotencyKey(request,reply);if(!idempotencyKey)return;
      if(!store.startCheckCommand)return reply.status(503).send({error:'COMMAND_RECEIPTS_UNAVAILABLE',message:'Надёжный запуск недоступен'});
      const result=await store.startCheckCommand(request.params.id,auditedCommand(request,actor,idempotencyKey),{sourceAuditV4Full:true});
      if(result.kind==='idempotency_conflict')return reply.status(409).send({error:'IDEMPOTENCY_CONFLICT',message:'Idempotency-Key уже использован для другой команды'});
      if(result.kind==='forbidden')return reply.status(403).send({error:'FORBIDDEN',message:'Нет права запускать проверку объекта'});
      if(result.kind==='not_found')return reply.status(404).send({error:'NOT_FOUND',message:'Объект не найден'});
      if(result.kind==='invalid_state')return reply.status(409).send({error:result.code,message:result.message});
      if(result.replayed)reply.header('Idempotency-Replayed','true');
      reply.header('Cache-Control','private, no-store');return reply.status(201).send(result.value);
    });
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id",
    { schema: fastifySchemaFor("getCheck") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCheck(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      if (resolved.value.rowVersion) reply.header("ETag", inspectionEtag(resolved.value.rowVersion));
      return resolved.value;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/findings",
    { schema: fastifySchemaFor("listCheckFindings") },
    async (request, reply) => {
      const check = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCheck(request.params.id, actor),
      );
      if (!check) return;
      if (!check.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      const findings = await store.getFindings(request.params.id, check.actor);
      if (!findings || findings === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      return { items: findings };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-layout",
    { schema: fastifySchemaFor("getCheckOcrLayout") },
    async (request, reply) => {
      if (!store.getOcrLayout) {
        return reply.status(503).send({ error: "OCR_LAYOUT_UNAVAILABLE", message: "OCR-результаты недоступны" });
      }
      const resolved = await resolveScopedRead(
        request, reply, (actor) => store.getOcrLayout!(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "OCR-результат активной проверки не найден" });
      }
      reply.header("Cache-Control", "private, no-store");
      return resolved.value;
    },
  );
  app.get<{ Params: { id: string; sourceFileId: string; pageNumber: string }; Querystring: { offset?: number } }>(
    "/api/checks/:id/ocr-layout/pages/:sourceFileId/:pageNumber",
    { schema: fastifySchemaFor("getCheckOcrLayoutPage") },
    async (request, reply) => {
      if (!store.getOcrLayoutPage) {
        return reply.status(503).send({ error: "OCR_LAYOUT_UNAVAILABLE", message: "OCR-результаты недоступны" });
      }
      const pageNumber = Number(request.params.pageNumber);
      const offset = request.query.offset ?? 0;
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1
        || !Number.isSafeInteger(offset) || offset < 0 || offset > 5000) {
        return reply.status(400).send({ error: "INVALID_PAGINATION", message: "Недопустимый номер страницы или смещение" });
      }
      const resolved = await resolveScopedRead(request, reply, (actor) => store.getOcrLayoutPage!(
        request.params.id, request.params.sourceFileId, pageNumber, offset, actor,
      ));
      if (!resolved) return;
      if (!resolved.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "OCR-страница активной проверки не найдена" });
      }
      reply.header("Cache-Control", "private, no-store");
      return resolved.value;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/visual-proposals",
    { schema: fastifySchemaFor("getCheckVisualProposals") },
    async (request, reply) => {
      if (!store.getVisualProposals) {
        return reply.status(503).send({ error: "VISUAL_PROPOSALS_UNAVAILABLE", message: "Визуальный анализ недоступен" });
      }
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getVisualProposals!(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Непроверенные предложения не найдены" });
      }
      reply.header("Cache-Control", "private, no-store");
      return resolved.value;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/review-candidate-decisions",
    { schema: fastifySchemaFor("listReviewCandidateDecisions") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.listReviewCandidateDecisions) {
        return reply.status(503).send({ error: "REVIEW_CANDIDATES_UNAVAILABLE", message: "Журнал подсказок недоступен" });
      }
      const result = await store.listReviewCandidateDecisions(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Запуск или подсказки недоступны" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: ReviewCandidateDecisionInput }>(
    "/api/checks/:id/review-candidate-decisions",
    { schema: fastifySchemaFor("recordReviewCandidateDecision"),
      preValidation: async (request, reply) => {
        const body = request.body;
        const fields = ["schemaVersion", "candidateId", "artifactHash", "decision", "note"];
        if (body && typeof body === "object" && !Array.isArray(body)
          && Object.keys(body).some(key => ![...fields, "details", "expectedDecisionHash"].includes(key))) {
          return reply.status(400).send({ error: "VALIDATION_ERROR", message: "Недопустимые поля решения" });
        }
      } },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять подсказки" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordReviewCandidateDecisionCommand) {
        return reply.status(503).send({ error: "REVIEW_CANDIDATES_UNAVAILABLE", message: "Журнал подсказок недоступен" });
      }
      const result = await store.recordReviewCandidateDecisionCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey));
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Подсказка недоступна" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять подсказки" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/visual-proposals/reviews",
    { schema: fastifySchemaFor("listVisualProposalReviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.listVisualProposalReviews) {
        return reply.status(503).send({ error: "VISUAL_REVIEW_UNAVAILABLE", message: "Журнал решений недоступен" });
      }
      const result = await store.listVisualProposalReviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: VisualProposalReviewInput }>(
    "/api/checks/:id/visual-proposals/reviews",
    { schema: fastifySchemaFor("recordVisualProposalReview") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права принимать решения" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordVisualProposalReviewCommand) {
        return reply.status(503).send({ error: "VISUAL_REVIEW_UNAVAILABLE", message: "Журнал решений недоступен" });
      }
      if (request.body.note.trim().length < 8) {
        return reply.status(400).send({ error: "VALIDATION_ERROR", message: "Основание решения слишком короткое" });
      }
      const result = await store.recordVisualProposalReviewCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey),
      );
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Артефакт или проверка не найдены" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права принимать решения" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-row-reviews",
    { schema: fastifySchemaFor("getOcrRowTranscriptionReviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrRowTranscriptionReviews) {
        return reply.status(503).send({ error: "OCR_ROW_REVIEW_UNAVAILABLE", message: "Журнал OCR-решений недоступен" });
      }
      const result = await store.getOcrRowTranscriptionReviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка или OCR-строки недоступны" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: OcrRowTranscriptionReviewInput }>(
    "/api/checks/:id/ocr-row-reviews",
    { schema: fastifySchemaFor("recordOcrRowTranscriptionReview"),
      preValidation: async (request, reply) => {
        // Fastify's AJV removes additional properties. Reject them before schema validation.
        const body = request.body;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const keys = Object.keys(body).sort();
          if (keys.length !== OCR_ROW_REVIEW_INPUT_FIELDS.length
            || keys.some((key, index) => key !== [...OCR_ROW_REVIEW_INPUT_FIELDS].sort()[index])) {
            return reply.status(400).send({ error: "VALIDATION_ERROR", message: "Недопустимые поля OCR-решения" });
          }
        }
      } },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять OCR-строки" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordOcrRowTranscriptionReviewCommand) {
        return reply.status(503).send({ error: "OCR_ROW_REVIEW_UNAVAILABLE", message: "Журнал OCR-решений недоступен" });
      }
      const result = await store.recordOcrRowTranscriptionReviewCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey),
      );
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка или OCR-строка недоступны" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять OCR-строки" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-row-applicability-reviews",
    { schema: fastifySchemaFor("getOcrRowApplicabilityReviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrRowApplicabilityReviews) {
        return reply.status(503).send({ error: "OCR_ROW_APPLICABILITY_UNAVAILABLE",
          message: "Журнал применимости OCR недоступен" });
      }
      const result = await store.getOcrRowApplicabilityReviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.get<{ Params: { id: string }; Querystring: { profile: "ocr-typed-fact-candidates-v1" } }>(
    "/api/checks/:id/ocr-typed-facts",
    { schema: fastifySchemaFor("getOcrTypedFactCandidates") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrTypedFactCandidates) {
        return reply.status(503).send({ error: "OCR_TYPED_FACT_UNAVAILABLE",
          message: "Просмотр OCR-кандидатов недоступен" });
      }
      const result = await store.getOcrTypedFactCandidates(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-fact-pair-reviews",
    { schema: fastifySchemaFor("getOcrFactPairReviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrFactPairReviews) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_REVIEW_UNAVAILABLE",
          message: "Журнал пар OCR-фактов недоступен" });
      }
      const result = await store.getOcrFactPairReviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: OcrFactPairReviewInput }>(
    "/api/checks/:id/ocr-fact-pair-reviews",
    { schema: fastifySchemaFor("recordOcrFactPairReview"),
      preValidation: async (request, reply) => {
        const body = request.body;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const keys = Object.keys(body).sort();
          if (keys.length !== OCR_FACT_PAIR_INPUT_FIELDS.length
            || keys.some((key, index) => key !== [...OCR_FACT_PAIR_INPUT_FIELDS].sort()[index])) {
            return reply.status(400).send({ error: "VALIDATION_ERROR",
              message: "Недопустимые поля решения о паре OCR-фактов" });
          }
        }
      } },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять пары OCR-фактов" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordOcrFactPairReviewCommand) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_REVIEW_UNAVAILABLE",
          message: "Журнал пар OCR-фактов недоступен" });
      }
      const result = await store.recordOcrFactPairReviewCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey));
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка или факты недоступны" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять пары OCR-фактов" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-fact-pair-snapshots",
    { schema: fastifySchemaFor("getOcrFactPairSnapshots") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrFactPairSnapshots) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_SNAPSHOT_UNAVAILABLE",
          message: "Снимки решений о парах недоступны" });
      }
      const result = await store.getOcrFactPairSnapshots(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-fact-pair-quantity-reviews",
    { schema: fastifySchemaFor("getOcrFactPairQuantityReviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrFactPairQuantityReviews) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_QUANTITY_UNAVAILABLE",
          message: "Журнал сопоставимости OCR-фактов недоступен" });
      }
      const result = await store.getOcrFactPairQuantityReviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: OcrFactPairQuantityReviewInput }>(
    "/api/checks/:id/ocr-fact-pair-quantity-reviews",
    { schema: fastifySchemaFor("recordOcrFactPairQuantityReview"),
      preValidation: async (request, reply) => {
        const body = request.body;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const keys = Object.keys(body).sort();
          if (keys.length !== OCR_FACT_PAIR_QUANTITY_INPUT_FIELDS.length
            || keys.some((key, index) => key !==
              [...OCR_FACT_PAIR_QUANTITY_INPUT_FIELDS].sort()[index])) {
            return reply.status(400).send({ error: "VALIDATION_ERROR",
              message: "Недопустимые поля решения о сопоставимости OCR-фактов" });
          }
        }
      } },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN",
          message: "Нет права проверять сопоставимость OCR-фактов" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordOcrFactPairQuantityReviewCommand) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_QUANTITY_UNAVAILABLE",
          message: "Журнал сопоставимости OCR-фактов недоступен" });
      }
      const result = await store.recordOcrFactPairQuantityReviewCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey));
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND",
          message: "Проверка или факты недоступны" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN",
          message: "Нет права проверять сопоставимость OCR-фактов" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT",
          message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/ocr-fact-pair-comparison-previews",
    { schema: fastifySchemaFor("getOcrFactPairComparisonPreviews") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.getOcrFactPairComparisonPreviews) {
        return reply.status(503).send({ error: "OCR_FACT_PAIR_COMPARISON_UNAVAILABLE",
          message: "Просмотр сравнения OCR-фактов недоступен" });
      }
      const result = await store.getOcrFactPairComparisonPreviews(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: OcrRowApplicabilityReviewInput }>(
    "/api/checks/:id/ocr-row-applicability-reviews",
    { schema: fastifySchemaFor("recordOcrRowApplicabilityReview"),
      preValidation: async (request, reply) => {
        const body = request.body;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const keys = Object.keys(body).sort();
          if (keys.length !== OCR_ROW_APPLICABILITY_INPUT_FIELDS.length
            || keys.some((key, index) => key !== [...OCR_ROW_APPLICABILITY_INPUT_FIELDS].sort()[index])) {
            return reply.status(400).send({ error: "VALIDATION_ERROR",
              message: "Недопустимые поля решения о применимости OCR" });
          }
        }
      } },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять OCR-строки" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordOcrRowApplicabilityReviewCommand) {
        return reply.status(503).send({ error: "OCR_ROW_APPLICABILITY_UNAVAILABLE",
          message: "Журнал применимости OCR недоступен" });
      }
      const result = await store.recordOcrRowApplicabilityReviewCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey));
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка или OCR-строка недоступны" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права проверять OCR-строки" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/fact-links",
    { schema: fastifySchemaFor("listFactEntityLinks") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      if (!store.listFactEntityLinks) {
        return reply.status(503).send({ error: "FACT_LINK_REVIEW_UNAVAILABLE", message: "Журнал связей недоступен" });
      }
      const result = await store.listFactEntityLinks(request.params.id, actor);
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      reply.header("Cache-Control", "private, no-store");
      return result;
    },
  );
  app.post<{ Params: { id: string }; Body: FactEntityLinkReviewInput }>(
    "/api/checks/:id/fact-links",
    { schema: fastifySchemaFor("recordFactEntityLink") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("REVIEW_DECIDE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права принимать решения" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      if (!store.recordFactEntityLinkCommand) {
        return reply.status(503).send({ error: "FACT_LINK_REVIEW_UNAVAILABLE", message: "Журнал связей недоступен" });
      }
      const result = await store.recordFactEntityLinkCommand(
        request.params.id, request.body, auditedCommand(request, actor, idempotencyKey),
      );
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка или предложение недоступны" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права принимать решения" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.status(201).send(result.value);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/coverage",
    { schema: fastifySchemaFor("getCheckCoverage") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => inventoryRequest(request,reply,signal=>store.getCoverage(request.params.id, actor,{signal})),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      return { items: resolved.value };
    },
  );
  app.get<{ Params: { id: string } }>("/api/checks/:id/matrix-execution",
    { schema: fastifySchemaFor("getCheckMatrixExecution") }, async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      const result = await inventoryRequest(request,reply,signal=>store.getMatrixExecution?.(request.params.id, actor,{signal}));
      if (!result || result === "AUTH_REQUIRED")
        return reply.status(404).send({ error: "NOT_FOUND", message: "Результат отсутствует или недоступен" });
      reply.header("Cache-Control", "private, no-store");
      reply.header("ETag", `"${result.contentHash}"`);
      return result;
    });
  app.get<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/call-inventory-pages',
    {schema:fastifySchemaFor('getMatrixCallInventorySourcePages')},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getMatrixCallInventorySourcePages?.(request.params.id,request.params.sourceFileId,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.post<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/call-inventory-preview',
    {schema:fastifySchemaFor('previewMatrixCallInventorySource'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      assertCallInventoryReviewNative(request.body);const input=z.object({selection:matrixCallInventorySelectionSchema}).strict().parse(request.body);
      const result=await store.previewMatrixCallInventorySource?.(request.params.id,request.params.sourceFileId,input.selection,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.get<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/water-node-pages',
    {schema:fastifySchemaFor('getMatrixWaterNodeSourcePages')},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getMatrixWaterNodeSourcePages?.(request.params.id,request.params.sourceFileId,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.post<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/water-node-preview',
    {schema:fastifySchemaFor('previewMatrixWaterNodeSource'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      assertWaterNodeReviewNative(request.body);const input=z.object({selection:matrixWaterNodeInventorySelectionSchema}).strict().parse(request.body);
      const result=await store.previewMatrixWaterNodeSource?.(request.params.id,request.params.sourceFileId,input.selection,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.get<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/rail-inventory-pages',
    {schema:fastifySchemaFor('getMatrixRailInventorySourcePages')},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getMatrixRailInventorySourcePages?.(request.params.id,request.params.sourceFileId,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.post<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/rail-inventory-preview',
    {schema:fastifySchemaFor('previewMatrixRailInventorySource'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      assertRailInventoryReviewNative(request.body);const input=z.object({selection:matrixRailInventorySelectionSchema}).strict().parse(request.body);
      const result=await store.previewMatrixRailInventorySource?.(request.params.id,request.params.sourceFileId,input.selection,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.post<{Params:{id:string;sourceFileId:string}}>('/api/checks/:id/source-files/:sourceFileId/lighting-technology-preview',
    {schema:fastifySchemaFor('previewMatrixLightingTechnologySource'),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      assertInventoryReviewNative(request.body);const input=z.object({selection:matrixLightingTechnologySelectionSchema}).strict().parse(request.body);
      const result=await store.previewMatrixLightingTechnologySource?.(request.params.id,request.params.sourceFileId,input.selection,actor);
      if(!result||result==='AUTH_REQUIRED')return reply.status(404).send({error:'NOT_FOUND',message:'Исходный текст отсутствует или недоступен'});
      reply.header('Cache-Control','private, no-store');return result;
    });
  app.get<{Params:{id:string};Querystring:{sourceFileId:string}}>("/api/checks/:id/source-text-v3",
    {schema:fastifySchemaFor("getDocumentTextV3Source")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getDocumentTextV3Source?.(request.params.id,request.query.sourceFileId,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.get<{Params:{id:string};Querystring:{sourceFileId:string}}>("/api/checks/:id/source-text-v3-large-v1",
    {schema:fastifySchemaFor("getDocumentTextV3LargeSource")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getDocumentTextV3LargeSource?.(request.params.id,request.query.sourceFileId,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.get<{Params:{id:string};Querystring:{sourceFileId:string}}>("/api/checks/:id/source-text-v4-full-source-v1",
    {schema:fastifySchemaFor("getDocumentTextV4FullSource")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getDocumentTextV4FullSource?.(request.params.id,request.query.sourceFileId,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.get<{Params:{id:string};Querystring:{sourceFileId:string;startPage:number;pageLimit:number;expectedArtifactContentHash?:string}}>("/api/checks/:id/source-text-v4-full-source-v1/pages",
    {schema:fastifySchemaFor("getDocumentTextV4FullSourcePageBatch")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const source=await store.getDocumentTextV4FullSource?.(request.params.id,request.query.sourceFileId,actor);
      if(!source||source==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      const result=documentTextV4FullPageBatch(source,request.query);
      if(!result)return reply.status(409).send({error:"SOURCE_PAGE_BATCH_MISMATCH",message:"Пакет вне диапазона или изменился hash полного артефакта"});
      reply.header("Cache-Control","private, no-store");return result;
    });

  app.get<{Params:{id:string};Querystring:{sourceFileId:string}}>("/api/checks/:id/source-inventory-pages",
    {schema:fastifySchemaFor("getMatrixInventorySourcePages")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getMatrixInventorySourcePages?.(request.params.id,request.query.sourceFileId,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.post<{Params:{id:string}}>("/api/checks/:id/source-inventory-preview",
    {schema:fastifySchemaFor("previewMatrixInventorySource"),bodyLimit:524288,preParsing:inventoryReviewPreParsing},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor||!verifyCsrf(request,reply,actor))return;
      assertInventoryReviewNative(request.body);
      const input=z.object({sourceFileId:z.string().min(1).max(200),selection:matrixInventorySelectionSchema}).strict().parse(request.body);
      const result=await store.previewMatrixInventorySource?.(request.params.id,input.sourceFileId,input.selection,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Исходный текст отсутствует или недоступен"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.get<{Params:{id:string}}>("/api/checks/:id/matrix-fact-targets",
    {schema:fastifySchemaFor("getMatrixFactTargets")},async(request,reply)=>{
      const actor=await requireActor(request,reply);if(!actor)return;
      const result=await store.getMatrixFactTargets?.(request.params.id,actor);
      if(!result||result==="AUTH_REQUIRED")return reply.status(404).send({error:"NOT_FOUND",message:"Факты отсутствуют или недоступны"});
      reply.header("Cache-Control","private, no-store");return result;
    });
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/pilot-results",
    { schema: fastifySchemaFor("getCheckPilotResults") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor) return;
      const result = store.getPilotResults
        ? await store.getPilotResults(request.params.id, actor)
        : await store.getCheck(request.params.id, actor);
      if (result === "FORBIDDEN") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права читать результаты проверки" });
      }
      if (!result || result === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      reply.header("Cache-Control", "private, no-store");
      if (!store.getPilotResults) {
        const check = result as CheckRun;
        return { checkId: check.id, status: check.status === "PROCESSING" ? "PROCESSING"
          : check.status === "FAILED" ? "FAILED" : "READY",
          items: [], ocrHeatRows: null };
      }
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/findings/:id",
    { schema: fastifySchemaFor("getFinding") },
    async (request, reply) => {
      let resource = await store.getFindingForReview(request.params.id);
      if (resource === "AUTH_REQUIRED") {
        const actor = await requireActor(request, reply);
        if (!actor) return;
        resource = await store.getFindingForReview(request.params.id, actor);
      }
      if (!resource || resource === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Кандидат не найден" });
      }
      reply.header("ETag", findingEtag(resource.rowVersion));
      return resource.finding;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/findings/:id/decision",
    { schema: fastifySchemaFor("decideFinding") },
    async (request, reply) => {
      let resource = await store.getFindingForReview(request.params.id);
      if (resource && resource !== "AUTH_REQUIRED" && resource.mode === "DEMO_SEED") {
        const input = decisionSchema.parse(request.body);
        const finding = await store.decideFinding(request.params.id, input);
        if (!finding || finding === "IDENTITY_REQUIRED") {
          return reply.status(404).send({ error: "NOT_FOUND", message: "Кандидат не найден" });
        }
        const updated = await store.getFindingForReview(request.params.id);
        if (updated && updated !== "AUTH_REQUIRED") reply.header("ETag", findingEtag(updated.rowVersion));
        return finding;
      }

      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      resource = await store.getFindingForReview(request.params.id, actor);
      if (!resource || resource === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Кандидат не найден" });
      }
      const input = decisionSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      const ifMatch = request.headers["if-match"];
      if (typeof idempotencyKey !== "string" || typeof ifMatch !== "string") {
        return reply.status(428).send({
          error: "PRECONDITION_REQUIRED",
          message: "Для решения нужны заголовки If-Match и Idempotency-Key",
        });
      }
      if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
        return reply.status(400).send({ error: "INVALID_IDEMPOTENCY_KEY", message: "Некорректный Idempotency-Key" });
      }
      const expectedVersion = parseFindingEtag(ifMatch);
      if (!expectedVersion) {
        return reply.status(400).send({ error: "INVALID_IF_MATCH", message: "Некорректный If-Match" });
      }
      const result = await store.decideFindingCommand(request.params.id, {
        actor,
        input,
        expectedVersion,
        idempotencyKey,
        requestId: request.id,
        traceId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"]?.slice(0, 1000),
      });
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Кандидат не найден" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Недостаточно прав для решения" });
      }
      if (result.kind === "precondition_failed") {
        reply.header("ETag", findingEtag(result.currentVersion));
        return reply.status(412).send({ error: "STALE_VERSION", message: "Версия кандидата изменилась" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency-Key уже использован для другой команды",
        });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      reply.header("ETag", findingEtag(result.rowVersion));
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return result.finding;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/checks/:id/reprocess",
    { schema: fastifySchemaFor("reprocessCheck") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCheck(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      if (resolved.actor && !verifyCsrf(request, reply, resolved.actor)) return;
      if (resolved.actor && !canOperateInspection(resolved.actor, "RUN_START")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Роль не разрешает перезапуск проверки" });
      }
      if (
        resolved.actor
        && !(await store.hasObjectPermission(resolved.value.objectId, resolved.actor, "RUN"))
      ) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права перезапускать проверку объекта" });
      }
      const idempotencyKey = resolved.actor ? requireIdempotencyKey(request, reply) : undefined;
      if (resolved.actor && !idempotencyKey) return;
      let check: CheckRun | undefined;
      if (resolved.actor && idempotencyKey) {
        if (!store.reprocessCommand) {
          return reply.status(503).send({
            error: "COMMAND_RECEIPTS_UNAVAILABLE",
            message: "Хранилище не поддерживает надёжный перезапуск проверки",
          });
        }
        const result = await store.reprocessCommand(
          request.params.id,
          auditedCommand(request, resolved.actor, idempotencyKey),
        );
        if (result.kind === "idempotency_conflict") {
          return reply.status(409).send({
            error: "IDEMPOTENCY_CONFLICT",
            message: "Idempotency-Key уже использован для другой команды",
          });
        }
        if (result.kind === "forbidden") {
          return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права перезапускать проверку объекта" });
        }
        if (result.kind === "not_found") {
          return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
        }
        if (result.kind === "invalid_state") {
          return reply.status(409).send({ error: result.code, message: result.message });
        }
        if (result.replayed) reply.header("Idempotency-Replayed", "true");
        check = result.value;
      } else {
        check = await store.reprocess(request.params.id, resolved.actor);
      }
      if (!check) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      const result = check.mode === "DEMO_SEED" || !store.completeJob
        ? await store.completeCheck(check.id)
        : check;
      return reply.status(200).send(result);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/checks/:id/finalize",
    { schema: fastifySchemaFor("finalizeCheck") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCheck(request.params.id, actor),
      );
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      if (resolved.value.mode === "DEMO_SEED" || !resolved.actor) {
        const result = await store.finalize(request.params.id);
        if (!result) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
        if (result === "PENDING_DECISIONS") {
          return reply.status(409).send({
            error: "PENDING_DECISIONS",
            message: "Сначала обработайте всех кандидатов",
          });
        }
        if (result === "INCOMPLETE_ANALYSIS") {
          return reply.status(409).send({
            error: "INCOMPLETE_ANALYSIS",
            message: "Нельзя финализировать проверку: исполняемые правила ещё не подключены",
          });
        }
        return reply.status(201).send(result);
      }
      if (resolved.actor && !verifyCsrf(request, reply, resolved.actor)) return;
      if (resolved.actor && !canOperateInspection(resolved.actor, "FINALIZE")) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Роль не разрешает финализацию проверки" });
      }
      if (
        resolved.actor
        && !(await store.hasObjectPermission(resolved.value.objectId, resolved.actor, "FINALIZE"))
      ) {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права финализировать проверку объекта" });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      const ifMatch = request.headers["if-match"];
      if (typeof ifMatch !== "string") {
        return reply.status(428).send({
          error: "PRECONDITION_REQUIRED",
          message: "Для финализации нужен заголовок If-Match",
        });
      }
      const expectedVersion = parseInspectionEtag(ifMatch);
      if (!expectedVersion) {
        return reply.status(400).send({ error: "INVALID_IF_MATCH", message: "Некорректный If-Match" });
      }
      const input = finalizeCheckSchema.parse(request.body);
      if (!store.finalizeCommand) {
        return reply.status(503).send({
          error: "COMMAND_RECEIPTS_UNAVAILABLE",
          message: "Хранилище не поддерживает надёжную финализацию",
        });
      }
      const result = await store.finalizeCommand(request.params.id, {
        ...auditedCommand(request, resolved.actor, idempotencyKey),
        input,
        expectedVersion,
      });
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права финализировать проверку объекта" });
      }
      if (result.kind === "precondition_failed") {
        reply.header("ETag", inspectionEtag(result.currentVersion));
        return reply.status(412).send({ error: "VERSION_MISMATCH", message: "Версия проверки изменилась" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency-Key уже использован для другой команды",
        });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      reply.header("ETag", inspectionEtag(result.rowVersion));
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return reply.status(201).send(result.protocol);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/protocols",
    { schema: fastifySchemaFor("listCheckProtocols") },
    async (request, reply) => {
      const check = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCheck(request.params.id, actor),
      );
      if (!check) return;
      if (!check.value) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      const protocols = await store.getProtocols(request.params.id, check.actor);
      if (!protocols || protocols === "AUTH_REQUIRED") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      }
      return { items: protocols };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/protocols/:id/revoke",
    { schema: fastifySchemaFor("revokeProtocol") },
    async (request, reply) => {
      const actor = await requireActor(request, reply);
      if (!actor || !verifyCsrf(request, reply, actor)) return;
      if (!canRevokeProtocol(actor)) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message: "Отзывать протокол может только руководитель или администратор",
        });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      const ifMatch = request.headers["if-match"];
      if (typeof ifMatch !== "string") {
        return reply.status(428).send({
          error: "PRECONDITION_REQUIRED",
          message: "Для отзыва нужен заголовок If-Match",
        });
      }
      const expectedVersion = parseInspectionEtag(ifMatch);
      if (!expectedVersion) {
        return reply.status(400).send({ error: "INVALID_IF_MATCH", message: "Некорректный If-Match" });
      }
      const input = revokeProtocolSchema.parse(request.body);
      if (!store.revokeProtocolCommand) {
        return reply.status(503).send({
          error: "COMMAND_RECEIPTS_UNAVAILABLE",
          message: "Хранилище не поддерживает надёжный отзыв протокола",
        });
      }
      const result = await store.revokeProtocolCommand(request.params.id, {
        ...auditedCommand(request, actor, idempotencyKey),
        input,
        expectedVersion,
      });
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Протокол не найден" });
      }
      if (result.kind === "forbidden") {
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права отзывать протокол объекта" });
      }
      if (result.kind === "precondition_failed") {
        reply.header("ETag", inspectionEtag(result.currentVersion));
        return reply.status(412).send({ error: "VERSION_MISMATCH", message: "Версия проверки изменилась" });
      }
      if (result.kind === "idempotency_conflict") {
        return reply.status(409).send({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency-Key уже использован для другой команды",
        });
      }
      if (result.kind === "invalid_state") {
        return reply.status(409).send({ error: result.code, message: result.message });
      }
      reply.header("ETag", inspectionEtag(result.revocation.rowVersion));
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      return reply.status(201).send(result.revocation);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/checks/:id/submission",
    { schema: fastifySchemaFor("getCheckSubmission") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => inventoryRequest(request,reply,signal=>store.getSubmission(request.params.id, actor,{signal})),
      );
      if (!resolved) return;
      const result = resolved.value;
      if (!result) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка не найдена" });
      if (result === "PENDING_DECISIONS") {
        return reply.status(409).send({ error: "PENDING_DECISIONS", message: "Сначала обработайте всех кандидатов" });
      }
      if (result === "INCOMPLETE_ANALYSIS") {
        return reply.status(409).send({
          error: "INCOMPLETE_ANALYSIS",
          message: "Нельзя экспортировать результат: исполняемые правила ещё не подключены",
        });
      }
      const bytes=canonicalJson(result);
      reply.header("Content-Disposition", `attachment; filename=submission-${request.params.id}.json`);
      reply.header("X-Content-SHA256",sha256(bytes));
      return reply.type("application/json").send(bytes);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/protocols/:id/export",
    { schema: fastifySchemaFor("exportProtocol") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getProtocolExport(request.params.id, actor),
      );
      if (!resolved) return;
      const exported = resolved.value;
      if (!exported) return reply.status(404).send({ error: "NOT_FOUND", message: "Протокол не найден" });
      reply.header("Content-Disposition", `attachment; filename=protocol-${exported.protocol.id}.json`);
      return exported;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/protocols/:id/artifacts/canonical-json",
    { schema: fastifySchemaFor("downloadCanonicalProtocolArtifact") },
    async (request, reply) => {
      const resolved = await resolveScopedRead(
        request,
        reply,
        (actor) => store.getCanonicalProtocolArtifact?.(request.params.id, actor),
      );
      if (!resolved) return;
      const content = resolved.value;
      if (!content) {
        return reply.status(404).send({
          error: "NOT_FOUND",
          message: "Протокол или сохранённый canonical artifact не найден",
        });
      }
      reply.header(
        "Content-Disposition",
        `attachment; filename=protocol-${content.artifact.protocolId}-canonical.json`,
      );
      reply.header("ETag", `"sha256-${content.artifact.contentHash}"`);
      reply.header("X-Content-SHA256", content.artifact.contentHash);
      reply.header("Cache-Control", "private, immutable, max-age=31536000");
      return reply.type("application/octet-stream").send(content.bytes);
    },
  );
  registerProtocolReportRoutes(app, { repository: store, resolveScopedRead });
  registerNativeAirflowRoutes(app, { repository: store, requireActor, verifyCsrf, requireIdempotencyKey, auditedCommand });
  registerSourceOcrImportRoutes(app, { repository: store, requireActor, verifyCsrf, requireIdempotencyKey, auditedCommand });
  registerNativeCapacityRoutes(app, { repository: store, requireActor, verifyCsrf, requireIdempotencyKey, auditedCommand });
  registerIaisPullRoutes(app, { repository: store, requireActor, schema: fastifySchemaFor("getIaisProtocolPull") });
  app.get("/api/parameters", { schema: fastifySchemaFor("listParameters") }, async () => ({
    items: await store.getParameters(),
  }));

  return app;
}
