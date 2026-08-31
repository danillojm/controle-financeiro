const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const htmlIds = [...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(match => match[1]);
const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicateIds)], [], 'Existem IDs duplicados no HTML');

const referencedIds = [...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]);
const missingIds = [...new Set(referencedIds)].filter(id => !htmlIds.includes(id));
assert.deepEqual(missingIds, [], 'app.js referencia IDs ausentes no HTML');

console.log('contrato DOM: todos os testes passaram');
