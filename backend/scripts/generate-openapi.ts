import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/core/openapi/registry';

buildOpenApiDocument().then((doc) => {
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2) + '\n');
  console.warn(`openapi.json written: ${Object.keys(doc.paths ?? {}).length} paths`);
});
