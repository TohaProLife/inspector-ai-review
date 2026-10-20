import { readFileSync } from 'node:fs';
import React, { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixExecutionPanel } from './MatrixExecutionPanel';
import { ColumnPylonSectionComparisonsPanel } from './ColumnPylonSectionComparisonsPanel';
import { api } from './api';

// Source inspection is deliberately static: no injected hooks, DOM or private closure execution.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const parent = read('./MatrixExecutionPanel.tsx');
const app = read('./App.tsx');
const contracts = read('../../../packages/contracts/src/matrix-execution.ts');
const oracle = JSON.parse(read('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json'));
const compact = (text: string) => text.replace(/\s+/gu, '');
// Deliberately bounded syntax checks, not an AST/type-semantic or mounted lifecycle proof.
function components(source: string, name: string): string[] {
  return source.match(new RegExp(`<${name}\\b[\\s\\S]*?\\/>`, 'gu')) ?? [];
}
function attributes(element: string): Record<string, string> {
  expect(element).not.toContain('{...');
  return Object.fromEntries(Array.from(element.matchAll(/(\w+)=\{([\s\S]*?)\}(?=\s+\w+=|\s*\/>)/gu), match => [match[1]!, compact(match[2]!)]));
}
function buttons(tree: React.ReactNode): React.ReactElement<any>[] {
  const result: React.ReactElement<any>[] = [];
  function visit(node: React.ReactNode) {
    if (!isValidElement(node)) return;
    const element = node as React.ReactElement<any>;
    if (element.type === 'button') result.push(element);
    React.Children.forEach(element.props.children, visit);
  }
  visit(tree); return result;
}
afterEach(() => vi.restoreAllMocks());

describe('KR060 parent saved-run seam: static composition and bounded SSR', () => {
  it('imports actual child once and forwards public context, saved manifest and all three saved siblings', () => {
    expect(parent.match(/import \{ ColumnPylonSectionComparisonsPanel \} from "\.\/ColumnPylonSectionComparisonsPanel";/gu)).toHaveLength(1);
    const children = components(parent, 'ColumnPylonSectionComparisonsPanel');
    expect(children).toHaveLength(1);
    expect(attributes(children[0]!)).toEqual({ objectId: 'objectId', inputManifestHash: 'data.execution.inputManifestHash', comparisons: 'data.columnPylonSectionComparisons', snapshot: 'data.columnPylonSectionSnapshot', evidence: 'data.columnPylonSectionComparisonEvidence', files: 'files', onSelect: 'selectInventory' });
  });
  it('keeps three saved transport fields optional with their exact generated types', () => {
    const expected = {
      columnPylonSectionComparisons: 'import("./matrix-column-pylon-section-execution.js").ColumnPylonSectionExecutionComparisons',
      columnPylonSectionSnapshot: 'import("./matrix-column-pylon-section-run-snapshot.js").ColumnPylonSectionRunSnapshot',
      columnPylonSectionComparisonEvidence: 'import("./matrix-column-pylon-section-execution.js").ColumnPylonSectionExecutionEvidence[]',
    };
    for (const [name, type] of Object.entries(expected)) {
      expect(contracts.split('\n').filter(line => line.trim() === `${name}?: ${type};`)).toHaveLength(1);
    }
  });
  it('real parent initial SSR renders no saved data and invokes no request or selection', () => {
    const matrix = vi.spyOn(api, 'getMatrixExecution');
    const files = vi.spyOn(api, 'listSourceFiles');
    const onSource = vi.fn();
    expect(renderToStaticMarkup(<MatrixExecutionPanel objectId="OBJ-SYNTHETIC-KR060" checkId="CHK-SYNTHETIC" onSource={onSource}/>)).toBe('');
    expect(matrix).not.toHaveBeenCalled(); expect(files).not.toHaveBeenCalled(); expect(onSource).not.toHaveBeenCalled();
  });
  it('statically forwards selected original unchanged and matches viewer filename by both source ID and SHA', () => {
    expect(compact(parent)).toContain('constselectInventory=(fragment:InspectorEvidence)=>{setSelected(null);setSelectedContext(null);setSelectedInventory(fragment);setPreferredRuleId(undefined);};');
    const viewer = components(parent, 'InspectorEvidenceViewer').filter(value => attributes(value).evidence === 'selectedInventory');
    expect(viewer).toHaveLength(1);
    expect(attributes(viewer[0]!)).toMatchObject({ objectId: 'objectId', stage: 'selectedInventory.stage', evidence: 'selectedInventory', file: 'files.find(f=>f.id===selectedInventory.sourceFileId&&f.sha256===selectedInventory.sourceSha256)' });
  });
  it('statically resets saved selection for object/check switches and receives App public object.id', () => {
    const effect = parent.match(/useEffect\(\(\)=>\{[\s\S]*?\},\[checkId,objectId\]\);/u)?.[0];
    expect(effect).toBeDefined();
    expect(compact(effect!)).toContain('setSelectedInventory(null)');
    expect(compact(effect!)).toContain('api.getMatrixExecution(checkId)');
    const mounts = components(app, 'MatrixExecutionPanel'); expect(mounts).toHaveLength(1);
    expect(attributes(mounts[0]!)).toMatchObject({ objectId: 'object.id', checkId: 'check.id' });
  });
  it('actual pure child tree selects exact saved PD/RD originals with raw LF and canonical single-normalized boxes', () => {
    const saved = structuredClone(oracle.wholeCases.find((value: any) => value.name === 'ported-strict-decrease'));
    const before = structuredClone(saved), onSelect = vi.fn();
    const tree = ColumnPylonSectionComparisonsPanel({ objectId: saved.expected.envelope.objectId, inputManifestHash: saved.expected.envelope.inputManifestHash, comparisons: saved.expected.envelope, snapshot: saved.snapshot, evidence: saved.expected.evidence, files: [], onSelect });
    renderToStaticMarkup(tree); expect(onSelect).not.toHaveBeenCalled();
    const actions = buttons(tree); expect(actions).toHaveLength(14);
    actions[0]!.props.onClick(); actions[7]!.props.onClick();
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ sourceFileId: 'SYNTHETIC-KR060-PD', sourceSha256: '02c5f228c03a18c977989956e08e30afed8d3ef301d5f0c2c0c17ea9cf9c1dbc', stage: 'PD', pageNumber: 1, value: 'Колонна 600х1500мм +0 этаж [Корпус 1]\n', bbox: [.005, .925, .755, .9875], unit: null });
    expect(onSelect.mock.calls[1]![0]).toMatchObject({ sourceFileId: 'SYNTHETIC-KR060-RD', sourceSha256: '130d933c15717fd18cd7950fe102de1f64da70b9f1877f622b1e9b3fb0762a04', stage: 'RD', pageNumber: 1, value: 'Колонна 500х1500мм +0 этаж [Корпус 1]\n', bbox: [.005, .925, .755, .9875], unit: null });
    expect(saved).toEqual(before);
  });
});
