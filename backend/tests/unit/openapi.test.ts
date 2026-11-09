import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/core/openapi/registry';

type Op = { parameters?: { name: string; in: string; required?: boolean }[]; responses: Record<string, unknown>; summary?: string };

describe('OpenAPI contract', async () => {
  const doc = await buildOpenApiDocument();
  const ops = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Op>).filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map(([method, op]) => ({ path, method, op })),
  );

  it('documents a meaningful number of operations', () => {
    expect(ops.length).toBeGreaterThan(100);
  });

  it('declares every {path param} as a required path parameter (typed clients and Flutter codegen depend on it)', () => {
    const problems: string[] = [];
    for (const { path, method, op } of ops) {
      for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)) {
        const p = op.parameters?.find((x) => x.in === 'path' && x.name === name);
        if (!p) problems.push(`${method.toUpperCase()} ${path}: {${name}} is not declared`);
        else if (!p.required) problems.push(`${method.toUpperCase()} ${path}: {${name}} must be required`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives every operation a summary and a success response', () => {
    const bad = ops.filter(({ op }) => !op.summary || !Object.keys(op.responses).some((c) => c.startsWith('2'))).map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(bad).toEqual([]);
  });
});
