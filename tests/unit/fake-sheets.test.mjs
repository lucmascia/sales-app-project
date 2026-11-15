import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSpreadsheet, createFakeServices } from '../fake-sheets.mjs';

test('setValues followed by getValues returns what was written', () => {
  const ss = createFakeSpreadsheet({ Dados: [['a', 'b']] });
  const sheet = ss.getSheetByName('Dados');
  sheet.getRange(2, 1, 1, 2).setValues([['x', 7]]);
  assert.deepEqual(sheet.getRange(1, 1, 2, 2).getValues(), [['a', 'b'], ['x', 7]]);
  assert.equal(sheet.getLastRow(), 2);
});

test('empty cells read back as empty string, like Sheets', () => {
  const ss = createFakeSpreadsheet({ Dados: [['a']] });
  assert.deepEqual(ss.getSheetByName('Dados').getRange(1, 1, 2, 2).getValues(), [['a', ''], ['', '']]);
});

test('insertSheet creates an empty sheet and getSheetByName returns null when missing', () => {
  const ss = createFakeSpreadsheet({});
  assert.equal(ss.getSheetByName('app'), null);
  const sheet = ss.insertSheet('app');
  assert.equal(sheet.getLastRow(), 0);
  assert.equal(ss.getSheetByName('app'), sheet);
});

test('setValues rejects a block whose size differs from the range, like Sheets', () => {
  const sheet = createFakeSpreadsheet({ Dados: [] }).getSheetByName('Dados');
  assert.throws(() => sheet.getRange(1, 1, 1, 2).setValues([['only one']]));
  assert.throws(() => sheet.getRange(1, 1, 0, 2));
});

test('a time-looking string becomes a Date unless the column is plain text, like Sheets', () => {
  const sheet = createFakeSpreadsheet({ Dados: [] }).getSheetByName('Dados');
  sheet.getRange(1, 1, 1, 1).setValues([['14:32:05']]);
  assert.equal(Object.prototype.toString.call(sheet.getRange(1, 1).getValue()), '[object Date]');
  sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.getRange(1, 2, 1, 1).setValues([['14:32:05']]);
  assert.equal(sheet.getRange(1, 2).getValue(), '14:32:05');
});

test('Utilities parses and formats a date in the given time zone', () => {
  const { Utilities } = createFakeServices();
  const d = Utilities.parseDate('2026-11-15', 'America/Sao_Paulo', 'yyyy-MM-dd');
  assert.equal(d.toISOString(), '2026-11-15T03:00:00.000Z');
  assert.equal(Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd'), '2026-11-15');
  assert.equal(Utilities.formatDate(new Date('2026-11-15T17:32:05Z'), 'America/Sao_Paulo', 'HH:mm:ss'), '14:32:05');
});
