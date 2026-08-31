const assert = require('node:assert/strict');
const core = require('../finance-core.js');

assert.equal(core.addMonths('2026-12', 1), '2027-01');
assert.equal(core.calculateInvoiceMonth('2026-08-09', 10), '2026-08');
assert.equal(core.calculateInvoiceMonth('2026-08-10', 10), '2026-09');
assert.equal(core.calculateDueDate('2026-02', 31), '2026-02-28');
assert.deepEqual(core.splitAmount(100, 3), [33.34, 33.33, 33.33]);
assert.equal(core.splitAmount(10, 4).reduce((sum, value) => sum + value, 0), 10);
assert.equal(core.netBalance(850, 420), 430);

console.log('finance-core: todos os testes passaram');
