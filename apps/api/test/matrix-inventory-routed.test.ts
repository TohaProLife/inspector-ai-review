import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { RoutedInspectionRepository } from '../src/repository-factory.js';
import { InspectorStore } from '../src/store.js';
import type { PostgresInspectionRepository } from '../src/postgres-repository.js';
import type { AuthenticatedActor, IdentityService } from '../src/identity.js';

const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(), displayName: 'Reviewer', roles: ['INSPECTOR'], capabilities: ['SOURCE_REVIEW'], csrfHash: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00Z' };
const identity: IdentityService = { login: async () => undefined, resolveSession: async token => token === 'session' ? actor : undefined, verifyCsrf: (_actor, token) => token === 'csrf', revokeSession: async () => undefined, close: async () => undefined };
const fixture = JSON.parse(readFileSync(new URL('../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json', import.meta.url), 'utf8')).fixtures[0];
const selection = fixture.input.selection;
const pages = { checkId: 'CHK-NORMAL', sourceFileId: 'FIL-1', sourceSha256: 'a'.repeat(64), inputManifestHash: 'b'.repeat(64), textStageContentHash: 'c'.repeat(64), textArtifactHash: 'd'.repeat(64), stage: 'PD', pageStages: {}, latestReviewHash: null, textArtifact: fixture.input.textArtifact };
const preview = { checkId: 'CHK-NORMAL', sourceFileId: 'FIL-1', sourceSha256: 'a'.repeat(64), result: { schemaVersion: 'matrix-inventory-source-result-v1', status: 'ABSTAIN', reasonCode: 'NO_ROWS' } };

it('running routed repository exposes authenticated explorer and CSRF preview without review writes', async () => {
  const normal = { close: vi.fn().mockResolvedValue(undefined), getMatrixInventorySourcePages: vi.fn().mockResolvedValue(pages), previewMatrixInventorySource: vi.fn().mockResolvedValue(preview), recordSourceReviewCommand: vi.fn() } as unknown as PostgresInspectionRepository;
  const repository = new RoutedInspectionRepository(await InspectorStore.create(), normal);
  const app = await buildApp({ repository, identityService: identity });
  try {
    const url = '/api/checks/CHK-NORMAL/source-inventory-pages?sourceFileId=FIL-1';
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(normal.getMatrixInventorySourcePages).not.toHaveBeenCalled();
    const found = await app.inject({ url, headers: { cookie: 'inspector_session=session' } });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(pages);
    expect(normal.getMatrixInventorySourcePages).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL', 'FIL-1', actor);
    const request = { method: 'POST' as const, url: '/api/checks/CHK-NORMAL/source-inventory-preview', payload: { sourceFileId: 'FIL-1', selection } };
    expect((await app.inject({ ...request, headers: { cookie: 'inspector_session=session' } })).statusCode).toBe(403);
    expect(normal.previewMatrixInventorySource).not.toHaveBeenCalled();
    const checked = await app.inject({ ...request, headers: { cookie: 'inspector_session=session; inspector_csrf=csrf', 'x-csrf-token': 'csrf' } });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toEqual(preview);
    expect(normal.previewMatrixInventorySource).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL', 'FIL-1', selection, actor);
    expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('demo check never falls through to durable inventory source reads', async () => {
  const demo = await InspectorStore.create();
  vi.spyOn(demo, 'getCheck').mockReturnValue({ id: 'CHK-DEMO' } as never);
  const normal = { getMatrixInventorySourcePages: vi.fn(), previewMatrixInventorySource: vi.fn() } as unknown as PostgresInspectionRepository;
  const repository = new RoutedInspectionRepository(demo, normal);
  expect(await repository.getMatrixInventorySourcePages?.('CHK-DEMO', 'FIL-1', actor)).toBeUndefined();
  expect(await repository.previewMatrixInventorySource?.('CHK-DEMO', 'FIL-1', selection, actor)).toBeUndefined();
  expect(normal.getMatrixInventorySourcePages).not.toHaveBeenCalled();
  expect(normal.previewMatrixInventorySource).not.toHaveBeenCalled();
});
