const assert = require("node:assert/strict");
const fs = require("node:fs");

const migration = fs.readFileSync("supabase/migration_v7.sql", "utf8");
const parser = fs.readFileSync(
  "angular-app/src/app/core/invoice-csv.ts",
  "utf8",
);
const pdfParser = fs.readFileSync(
  "angular-app/src/app/core/invoice-pdf.ts",
  "utf8",
);
const angularConfig = fs.readFileSync("angular-app/angular.json", "utf8");
const debts = fs.readFileSync(
  "angular-app/src/app/pages/debts/debts.ts",
  "utf8",
);
const template = fs.readFileSync(
  "angular-app/src/app/pages/debts/debts.html",
  "utf8",
);

assert.match(
  migration,
  /import_fingerprint/,
  "Migração v7 sem identificação da importação",
);
assert.match(
  migration,
  /unique index/,
  "Migração v7 não bloqueia duplicidades",
);
assert.match(parser, /parseInvoiceCsv/, "Leitor de CSV ausente");
assert.match(
  parser,
  /parseInvoiceAmount/,
  "Conversão monetária da fatura ausente",
);
assert.match(debts, /ignoreDuplicates: true/, "Importação não é idempotente");
assert.match(
  debts,
  /checkingDuplicates/,
  "Importação não aguarda a verificação de duplicidades",
);
assert.match(template, /Importar fatura/, "Acesso à importação ausente");
assert.match(template, /application\/pdf/, "Seletor não aceita faturas em PDF");
assert.match(
  pdfParser,
  /import\('pdfjs-dist'\)/,
  "Leitor de PDF não é carregado sob demanda",
);
assert.match(
  pdfParser,
  /parseInvoicePdfLines/,
  "Conversão do PDF em compras ausente",
);
assert.match(
  angularConfig,
  /pdf\.worker\.min\.mjs/,
  "Worker local do PDF ausente",
);
assert.match(
  template,
  /Possível duplicidade/,
  "Prévia não informa duplicidades",
);

console.log("contrato v7: importação de fatura segura e idempotente");
