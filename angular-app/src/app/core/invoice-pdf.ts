import { normalizeInvoiceDescription, parseInvoiceDate } from './invoice-csv';

export interface PdfInvoiceDocument {
  headers: string[];
  records: string[][];
  pages: number;
  extractedLines: number;
  sourceLines: string[];
}

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const monthNumbers: Record<string, number> = {
  JAN: 1,
  FEV: 2,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  APR: 4,
  MAI: 5,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  AUG: 8,
  SET: 9,
  SEP: 9,
  OUT: 10,
  OCT: 10,
  NOV: 11,
  DEZ: 12,
  DEC: 12,
};

const cleanText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const inferYear = (month: number, invoiceMonth: string) => {
  const [year, invoiceMonthNumber] = invoiceMonth.split('-').map(Number);
  return month > invoiceMonthNumber ? year - 1 : year;
};

const isoDateFromPdf = (raw: string, invoiceMonth: string) => {
  const full = parseInvoiceDate(raw);
  if (full) return full;
  const numeric = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (numeric) {
    const day = Number(numeric[1]),
      month = Number(numeric[2]),
      year = inferYear(month, invoiceMonth),
      candidate = parseInvoiceDate(
        `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
      );
    return candidate;
  }
  const word = cleanText(raw).match(/^(\d{1,2})\s+([A-Z]{3})(?:\s+(\d{2,4}))?$/);
  if (!word || !monthNumbers[word[2]]) return '';
  const month = monthNumbers[word[2]],
    suppliedYear = word[3] ? Number(word[3]) : 0,
    year = suppliedYear
      ? suppliedYear < 100
        ? suppliedYear + 2000
        : suppliedYear
      : inferYear(month, invoiceMonth);
  return parseInvoiceDate(
    `${String(Number(word[1])).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
  );
};

const dateAtStart = (line: string) => {
  const patterns = [
    /^\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/,
    /^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/,
    /^\s*(\d{1,2}[./-]\d{1,2})\b/,
    /^\s*(\d{1,2}\s+(?:JAN|FEV|FEB|MAR|ABR|APR|MAI|MAY|JUN|JUL|AGO|AUG|SET|SEP|OUT|OCT|NOV|DEZ|DEC)(?:\s+\d{2,4})?)\b/i,
  ];
  return patterns.map((pattern) => line.match(pattern)).find(Boolean) || null;
};

const amountAtEnd = (line: string) =>
  line.match(/((?:R\$\s*)?\(?-?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d+)[,.]\d{2}\)?)(?:\s*(CR))?\s*$/i);

export const parseInvoicePdfLines = (lines: string[], invoiceMonth: string) => {
  const records: string[][] = [];
  for (const source of lines) {
    const line = source.replace(/\s+/g, ' ').trim(),
      dateMatch = dateAtStart(line),
      amountMatch = amountAtEnd(line);
    if (!dateMatch || !amountMatch || amountMatch.index === undefined) continue;
    const date = isoDateFromPdf(dateMatch[1], invoiceMonth),
      description = normalizeInvoiceDescription(
        line
          .slice((dateMatch.index || 0) + dateMatch[0].length, amountMatch.index)
          .replace(/^[\s|:;—–-]+|[\s|:;—–-]+$/g, ''),
      );
    if (!date || description.length < 2) continue;
    const credit = Boolean(amountMatch[2]),
      amount = amountMatch[1].trim().replace(/^-\s+/, '-'),
      rawAmount = `${credit && !amount.includes('-') ? '-' : ''}${amount}`;
    records.push([date, description, rawAmount]);
  }
  return records;
};

const buildPageLines = (items: PositionedText[]) => {
  const groups: { y: number; height: number; items: PositionedText[] }[] = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const group = groups.find(
      (candidate) => Math.abs(candidate.y - item.y) <= Math.max(2.5, item.height * 0.4),
    );
    if (group) group.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups
    .sort((a, b) => b.y - a.y)
    .map((group) => {
      let result = '',
        previousEnd = 0;
      for (const item of group.items.sort((a, b) => a.x - b.x)) {
        const gap = item.x - previousEnd;
        if (result && gap > 1.5 && !result.endsWith(' ')) result += ' ';
        result += item.text;
        previousEnd = Math.max(previousEnd, item.x + item.width);
      }
      return result.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
};

export const extractInvoicePdf = async (
  buffer: ArrayBuffer,
  invoiceMonth: string,
  requestPassword: () => string | null,
): Promise<PdfInvoiceDocument> => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).href;
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  let passwordCancelled = false;
  loading.onPassword = (setPassword: (password: string) => void) => {
    const password = requestPassword();
    if (password === null) {
      passwordCancelled = true;
      void loading.destroy();
      return;
    }
    setPassword(password);
  };
  let pdf: Awaited<typeof loading.promise> | undefined;
  try {
    pdf = await loading.promise;
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber),
        content = await page.getTextContent(),
        items = content.items
          .filter(
            (
              item,
            ): item is typeof item & {
              str: string;
              transform: number[];
              width: number;
              height: number;
            } => 'str' in item && Boolean(item.str.trim()),
          )
          .map((item) => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height,
          }));
      lines.push(...buildPageLines(items));
    }
    const records = parseInvoicePdfLines(lines, invoiceMonth);
    if (!lines.length)
      throw new Error(
        'Este PDF parece ser uma imagem digitalizada. A versão atual precisa de um PDF com texto selecionável.',
      );
    if (!records.length)
      throw new Error(
        'Não encontrei compras automaticamente neste PDF. Confirme se ele contém data, descrição e valor em cada lançamento.',
      );
    return {
      headers: ['Data', 'Descrição', 'Valor'],
      records,
      pages: pdf.numPages,
      extractedLines: lines.length,
      sourceLines: lines,
    };
  } catch (error) {
    if (passwordCancelled) throw new Error('A leitura do PDF protegido foi cancelada.');
    throw error;
  } finally {
    await loading.destroy();
  }
};
