// A small stand-in for the Google Apps Script services that Code.gs uses, so the
// real script can run under Node. It copies the Sheets behaviours that bite:
// empty cells read as '', setValues must match the range size, zero-row ranges
// throw, and strings that look like numbers or times are converted on write
// unless the cell is formatted as plain text.
import { readFileSync } from 'node:fs';

const MAX_ROWS = 1000;
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

function coerceOnWrite(value, format) {
  if (typeof value !== 'string' || format === '@') return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  const time = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (time) return new Date(Date.UTC(1899, 11, 30, +time[1], +time[2], +time[3]));
  return value;
}

function createSheet(name, rows) {
  const data = rows.map((r) => r.slice());
  let maxRows = Math.max(MAX_ROWS, rows.length);
  const formats = new Map(); // column -> number format, applied by setNumberFormat
  const sheet = {
    frozenRows: 0,
    getName: () => name,
    getMaxRows: () => maxRows,
    insertRowsAfter(afterRow, howMany) { maxRows += howMany; return sheet; },
    getLastRow() {
      for (let r = data.length; r > 0; r--) {
        if ((data[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
      }
      return 0;
    },
    getLastColumn() {
      let last = 0;
      for (const row of data) {
        for (let c = row.length; c > last; c--) {
          if (row[c - 1] !== '' && row[c - 1] !== undefined && row[c - 1] !== null) { last = c; break; }
        }
      }
      return last;
    },
    getRange(row, col, numRows = 1, numCols = 1) {
      if (!(row >= 1) || !(col >= 1)) throw new Error('Range start must be at least 1');
      if (!(numRows >= 1)) throw new Error('The number of rows in the range must be at least 1.');
      if (!(numCols >= 1)) throw new Error('The number of columns in the range must be at least 1.');
      if (row + numRows - 1 > maxRows) throw new Error('Those rows are out of bounds.');
      const cell = (r, c) => {
        const v = (data[r - 1] || [])[c - 1];
        return v === undefined || v === null ? '' : v;
      };
      const range = {
        getValues() {
          const out = [];
          for (let r = row; r < row + numRows; r++) {
            const line = [];
            for (let c = col; c < col + numCols; c++) line.push(cell(r, c));
            out.push(line);
          }
          return out;
        },
        getValue: () => cell(row, col),
        setValues(values) {
          if (values.length !== numRows || values.some((v) => v.length !== numCols)) {
            throw new Error(`The data size does not match the range: expected ${numRows}x${numCols}.`);
          }
          values.forEach((line, i) => {
            const r = row + i;
            while (data.length < r) data.push([]);
            line.forEach((v, j) => {
              const c = col + j;
              while (data[r - 1].length < c) data[r - 1].push('');
              data[r - 1][c - 1] = coerceOnWrite(v, formats.get(c));
            });
          });
          return range;
        },
        setValue(v) { return range.setValues([[v]]); },
        setNumberFormat(format) {
          for (let c = col; c < col + numCols; c++) formats.set(c, format);
          return range;
        },
        setFontWeight: () => range,
      };
      return range;
    },
    getDataRange() {
      return sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), Math.max(sheet.getLastColumn(), 1));
    },
    appendRow(values) {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
      return sheet;
    },
    setFrozenRows(n) { sheet.frozenRows = n; },
    // test helpers (not part of the Apps Script API)
    _rows: () => data.slice(0, sheet.getLastRow()).map((r) => r.slice()),
    _format: (col) => formats.get(col),
    _setMaxRows(n) { maxRows = n; },
  };
  return sheet;
}

export function createFakeSpreadsheet(sheets = {}, { timeZone = 'America/Sao_Paulo' } = {}) {
  const byName = new Map(Object.entries(sheets).map(([n, rows]) => [n, createSheet(n, rows)]));
  return {
    getSheetByName: (n) => byName.get(n) || null,
    insertSheet(n) {
      if (byName.has(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
      const sheet = createSheet(n, []);
      byName.set(n, sheet);
      return sheet;
    },
    getSpreadsheetTimeZone: () => timeZone,
    _sheetNames: () => [...byName.keys()],
  };
}

function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function createFakeServices(spreadsheet) {
  const lock = { waits: 0, releases: 0 };
  const Utilities = {
    formatDate(date, timeZone, format) {
      if (!isDate(date)) throw new Error('formatDate expects a Date');
      const p = partsIn(date, timeZone);
      const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
      return format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token]);
    },
    parseDate(text, timeZone, format) {
      if (format !== 'yyyy-MM-dd') throw new Error(`fake parseDate does not support ${format}`);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (!m) throw new Error(`Unparseable date: ${text}`);
      const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      const p = partsIn(new Date(asUtc), timeZone);
      const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return new Date(asUtc - (shown - asUtc));
    },
  };
  return {
    lock,
    Utilities,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: {
      getScriptLock: () => ({
        waitLock() { lock.waits++; },
        releaseLock() { lock.releases++; },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        const out = { mimeType: null, getContent: () => text, setMimeType(m) { out.mimeType = m; return out; } };
        return out;
      },
    },
  };
}

// Runs the real Code.gs against the fake services. `now` pins the clock that the
// script sees through `new Date()`.
export function loadScript(path, spreadsheet, { now } = {}) {
  const services = createFakeServices(spreadsheet);
  const FakeDate = now
    ? class extends Date { constructor(...args) { if (args.length) super(...args); else super(now.getTime()); } }
    : Date;
  const source = readFileSync(path, 'utf8');
  const factory = new Function(
    'SpreadsheetApp', 'LockService', 'ContentService', 'Utilities', 'Date',
    `${source}\nreturn { doGet, doPost };`,
  );
  const script = factory(services.SpreadsheetApp, services.LockService, services.ContentService, services.Utilities, FakeDate);
  const read = (output) => JSON.parse(output.getContent());
  return {
    ...script,
    lock: services.lock,
    get: (parameter) => read(script.doGet({ parameter })),
    post: (body) => read(script.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
  };
}
