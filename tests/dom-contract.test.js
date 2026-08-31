const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const routes = fs.readFileSync('angular-app/src/app/app.routes.ts', 'utf8');
assert.match(index, /<app-root>/, 'O build publicado não contém a raiz Angular');
for (const route of ['inicio', 'lancamento', 'dividas', 'historico', 'relatorios', 'cadastros']) {
  assert.match(routes, new RegExp(`path: '${route}'`), `Rota Angular ausente: ${route}`);
}
for (const file of [
  'angular-app/src/app/app.html',
  'angular-app/src/app/pages/dashboard/dashboard.html',
  'angular-app/src/app/pages/entry/entry.html',
  'angular-app/src/app/pages/debts/debts.html',
  'angular-app/src/app/pages/history/history.html',
  'angular-app/src/app/pages/registers/registers.html',
]) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = [...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, `IDs duplicados em ${file}`);
}
console.log('contrato DOM Angular: todos os testes passaram');
