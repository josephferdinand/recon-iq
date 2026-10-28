import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistry, dereference, operations, root, spec, validateExample } from '../../docs/openapi/validate-coverage.mjs';

const read = (file: string) => readFileSync(join(root, file), 'utf8');
const examples = JSON.parse(read('docs/openapi/contract-examples.json'));
const newReads = operations.filter(({ path }) => path.endsWith('/runs/history') || path.endsWith('/runs/{runId}/results'));

describe('Pascal incremental API contracts', () => {
  it.each(examples)('validates the positive/negative schema example $id', (example) => {
    const result = validateExample(example);
    expect(result.valid, JSON.stringify(result.errors)).toBe(example.valid);
  });
  it('detects method, route, handler, schema, scope and source-hash registry drift', () => {
    expect(JSON.parse(read('docs/openapi/coverage-registry.json'))).toEqual(buildRegistry());
  });
  it('keeps every documented tenant scope issuable by the explicit source catalog', () => {
    const catalog = new Set([...read('src/lib/api-token-scopes.ts').matchAll(/id: "([^"]+)"/gu)].map(m => m[1]));
    for (const { path, operation } of operations.filter(e => e.path.startsWith('/api/v1/'))) {
      for (const scope of [operation['x-required-scope']].flat()) expect(catalog.has(scope), `${path}: ${scope}`).toBe(true);
    }
  });
  it('declares complete path parameters and independent auth for each new read', () => {
    expect(newReads).toHaveLength(2);
    for (const { path, operation, parameters } of newReads) {
      const resolved = parameters.map(dereference);
      for (const match of path.matchAll(/\{([^}]+)\}/gu)) expect(resolved).toContainEqual(expect.objectContaining({ name: match[1], in: 'path', required: true }));
      expect(operation.security).toEqual([{ tenantApiToken: [] }]);
      expect(operation['x-required-scope']).toBe('recons.read');
      expect(resolved.some(p => p.name === 'Idempotency-Key')).toBe(false);
      expect(operation['x-availability']).toContain('SQL port held');
      expect(Object.keys(operation.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '503']);
    }
  });
  it('matches query bounds and enum defaults to the actual read adapter', () => {
    const source = read('src/lib/public-recon-read-authorization.server.ts');
    expect(source).toContain('page > 10000');
    expect(source).toContain('[1, 7, 14, 30, 90]');
    const sourceStatuses = JSON.parse(source.match(/const resultStatuses = (\[[^\n]+\]) as const/u)![1]);
    for (const { parameters } of newReads) {
      const resolved = parameters.map(dereference);
      expect(resolved.find(p => p.name === 'page').schema).toMatchObject({ maximum: 10000, minimum: 1, default: 1 });
      const days = resolved.find(p => p.name === 'days');
      if (days) expect(days.schema).toMatchObject({ enum: [1, 7, 14, 30, 90], default: 30 });
      const status = resolved.find(p => p.name === 'status');
      if (status) expect(status.schema).toMatchObject({ enum: sourceStatuses, default: 'all' });
    }
  });
  it('preserves nullable stored counts and the string audit receipt contract', () => {
    for (const name of ['ReconReadHistory', 'ReconReadResults']) {
      expect(spec.components.schemas[name].properties.audit_id).toEqual({ type: 'string', pattern: '^[1-9][0-9]{0,18}$' });
    }
    for (const field of ['matched_count', 'exception_count', 'total_rows', 'matched_input_memberships']) expect(spec.components.schemas.ReconReadRun.properties[field].type).toEqual(['number', 'null']);
    expect(spec.components.schemas.ReconReadResults.properties.results.maxItems).toBe(50);
  });
  it('labels hosted-document evidence without inferring business-route deployment', () => {
    const observations = JSON.parse(read('docs/openapi/served-observations-2026-10-03.json'));
    expect(observations.map(o => o.environment)).toEqual(['PROD', 'DEV']);
    for (const observation of observations) {
      expect(observation.url).toMatch(/^https:\/\/(app|dev\.app)\.falconveritas\.com\/api\/public\/openapi\.yaml$/u);
      expect(observation.evidence).toContain('business-route behavior and auth/RBAC not exercised');
      expect(observation.at_utc).toMatch(/^2026-10-03T/u);
      expect(observation.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(observation.operations.every(op => op.path.startsWith('/api/'))).toBe(true);
    }
    expect(spec.servers).toBeUndefined();
  });
});
