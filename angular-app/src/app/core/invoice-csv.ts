export interface CsvDocument {
  delimiter: string;
  headers: string[];
  records: string[][];
}

export interface InvoiceColumnMapping {
  date: number;
  description: number;
  amount: number;
}

const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseRows = (text: string, delimiter: string) => {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

export const parseInvoiceCsv = (source: string): CsvDocument => {
  let text = source.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('O arquivo CSV está vazio.');

  const separator = text.match(/^sep=(.)\s*(?:\r?\n)/i);
  let delimiter = separator?.[1] || '';
  if (separator) text = text.slice(separator[0].length);
  if (!delimiter) {
    delimiter = [';', ',', '\t']
      .map((candidate) => ({ candidate, columns: parseRows(text, candidate)[0]?.length || 0 }))
      .sort((a, b) => b.columns - a.columns)[0].candidate;
  }

  const rows = parseRows(text, delimiter);
  if (rows.length < 2 || rows[0].length < 2)
    throw new Error('O CSV precisa ter cabeçalho e pelo menos uma compra.');
  const width = rows[0].length;
  return {
    delimiter,
    headers: rows[0].map((value, index) => value || `Coluna ${index + 1}`),
    records: rows
      .slice(1)
      .map((row) => Array.from({ length: width }, (_, index) => row[index] || '')),
  };
};

const findColumn = (headers: string[], candidates: string[]) => {
  const values = headers.map(normalized);
  for (const candidate of candidates) {
    const exact = values.indexOf(candidate);
    if (exact >= 0) return exact;
  }
  for (const candidate of candidates) {
    const partial = values.findIndex((value) => value.includes(candidate));
    if (partial >= 0) return partial;
  }
  return -1;
};

export const detectInvoiceColumns = (headers: string[]): InvoiceColumnMapping => ({
  date: findColumn(headers, [
    'data',
    'date',
    'datacompra',
    'datatransacao',
    'datalancamento',
    'transactiondate',
  ]),
  description: findColumn(headers, [
    'descricao',
    'description',
    'title',
    'estabelecimento',
    'lancamento',
    'historico',
    'merchant',
    'nome',
  ]),
  amount: findColumn(headers, [
    'valor',
    'amount',
    'value',
    'valordacompra',
    'valoremreais',
    'quantia',
  ]),
});

const validDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export const parseInvoiceDate = (raw: string) => {
  const value = raw.trim();
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/),
    year: number,
    month: number,
    day: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!match) return '';
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  }
  return validDate(year, month, day)
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';
};

export const parseInvoiceAmount = (raw: string) => {
  const original = raw.trim();
  if (!original) return null;
  const parenthesized = /^\(.*\)$/.test(original),
    clean = original.replace(/[^\d,.-]/g, '').replace(/(?!^)-/g, ''),
    negative = parenthesized || clean.startsWith('-'),
    unsigned = clean.replace('-', '');
  if (!unsigned) return null;
  const comma = unsigned.lastIndexOf(','),
    dot = unsigned.lastIndexOf('.');
  let normalizedValue = unsigned;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    normalizedValue = unsigned.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else {
    const separator = comma >= 0 ? ',' : dot >= 0 ? '.' : '';
    if (separator) {
      const parts = unsigned.split(separator),
        decimals = parts.at(-1) || '';
      normalizedValue =
        decimals.length > 0 && decimals.length <= 2
          ? `${parts.slice(0, -1).join('')}.${decimals}`
          : parts.join('');
    }
  }
  const amount = Number(`${negative ? '-' : ''}${normalizedValue}`);
  return Number.isFinite(amount) ? amount : null;
};

export const normalizeInvoiceDescription = (value: string) =>
  value.trim().replace(/\s+/g, ' ').slice(0, 240);

export const invoiceFingerprint = async (
  cardId: string,
  invoiceMonth: string,
  date: string,
  description: string,
  amount: number,
  occurrence: number,
) => {
  const source = `invoice-v1|${cardId}|${invoiceMonth.slice(0, 7)}|${date}|${normalized(description)}|${Math.round(amount * 100)}|${occurrence}`,
    digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
