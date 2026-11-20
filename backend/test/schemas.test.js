import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../shared/schemas/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('shared/schemas has the three §6.4 contracts', () => {
  assert.deepEqual(files.sort(), ['enrich.v1.json', 'envelope.v1.json', 'triage.v1.json']);
});

for (const file of files) {
  test(`${file} parses and its $id matches the file name`, () => {
    const schema = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    assert.equal(schema.$id, file.replace(/\.json$/, ''));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  });
}
