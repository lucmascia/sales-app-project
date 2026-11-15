import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/js/store.js';
import { createApi } from '../../app/js/api.js';
import { createSyncer } from '../../app/js/sync.js';
import { SALE_CREDITO, SALE_TWO_LINES } from '../fixtures.mjs';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => map.delete(k) };
}
const local = (sale, extra = {}) => ({ ...sale, sync: 'pending', cancelSync: null, holdUntil: 0, ...extra });
const jsonResponse = (data) => ({ text: async () => JSON.stringify(data) });

function fakeApi() {
  const calls = [];
  const known = new Set();
  return {
    calls,
    fail: null,
    async sync(payload) {
      calls.push(JSON.parse(JSON.stringify(payload)));
      if (this.fail) throw new Error(this.fail);
      const saved = [], duplicates = [];
      for (const s of payload.sales) (known.has(s.id) ? duplicates : saved).push(s.id), known.add(s.id);
      const canceled = payload.cancels.filter((id) => known.has(id));
      return { ok: true, saved, duplicates, canceled, notFound: payload.cancels.filter((id) => !known.has(id)) };
    },
  };
}

// ---- store ----

test('settings start with the fair cost defaults and remember changes', () => {
  const store = createStore(memoryStorage());
  assert.deepEqual(store.getSettings(), { scriptUrl: '', seller: '', feePct: 10, feeFixed: 45 });
  store.saveSettings({ seller: 'Lucas', feePct: 12 });
  assert.deepEqual(store.getSettings(), { scriptUrl: '', seller: 'Lucas', feePct: 12, feeFixed: 45 });
});

test('sales survive a reload of the app', () => {
  const storage = memoryStorage();
  createStore(storage).addSale(local(SALE_CREDITO));
  const again = createStore(storage);
  assert.equal(again.getSales().length, 1);
  assert.equal(again.getSales()[0].id, SALE_CREDITO.id);
});

test('a sale can be updated and removed by id', () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  store.addSale(local(SALE_TWO_LINES));
  store.updateSale(SALE_CREDITO.id, { canceled: true });
  assert.equal(store.getSales()[0].canceled, true);
  store.removeSale(SALE_CREDITO.id);
  assert.deepEqual(store.getSales().map((s) => s.id), [SALE_TWO_LINES.id]);
});

test('corrupt saved data does not stop the app from opening', () => {
  const storage = memoryStorage();
  storage.setItem('mv.sales', '{broken');
  storage.setItem('mv.settings', 'null');
  const store = createStore(storage);
  assert.deepEqual(store.getSales(), []);
  assert.equal(store.getSettings().feePct, 10);
});

test('a failure to save a sale is not swallowed', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => createStore(storage).addSale(local(SALE_CREDITO)), /Quota/);
});

test('old sales already in the sheet are pruned, unsent ones never', () => {
  const store = createStore(memoryStorage());
  store.addSale(local({ ...SALE_CREDITO, id: 'old-sent', date: '2026-06-01' }, { sync: 'sent' }));
  store.addSale(local({ ...SALE_CREDITO, id: 'old-pending', date: '2026-06-01' }));
  store.addSale(local({ ...SALE_CREDITO, id: 'old-cancel', date: '2026-06-01' }, { sync: 'sent', cancelSync: 'pending' }));
  store.addSale(local({ ...SALE_CREDITO, id: 'recent', date: '2026-11-01' }, { sync: 'sent' }));
  store.prune('2026-11-15');
  assert.deepEqual(store.getSales().map((s) => s.id), ['old-pending', 'old-cancel', 'recent']);
});

// ---- syncer ----

test('pending sales are sent without the phone-only fields and marked as sent', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  const result = await createSyncer({ store, getApi: () => api }).run();
  assert.deepEqual(result, { sent: 1, failed: 0, error: null });
  assert.deepEqual(api.calls[0], { sales: [SALE_CREDITO], cancels: [] });
  assert.equal(store.getSales()[0].sync, 'sent');
});

test('a failed send keeps the sale pending and reports the error', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  api.fail = 'Sem conexão com a planilha.';
  const syncer = createSyncer({ store, getApi: () => api });
  assert.deepEqual(await syncer.run(), { sent: 0, failed: 1, error: 'Sem conexão com a planilha.' });
  assert.equal(store.getSales()[0].sync, 'pending');
  assert.equal(syncer.pendingCount(), 1);
  api.fail = null;
  await syncer.run();
  assert.equal(syncer.pendingCount(), 0);
});

test('a sale the sheet already had is treated as sent, not sent forever', async () => {
  const store = createStore(memoryStorage());
  const api = fakeApi();
  await api.sync({ sales: [SALE_CREDITO], cancels: [] }); // the earlier attempt whose answer was lost
  store.addSale(local(SALE_CREDITO));
  await createSyncer({ store, getApi: () => api }).run();
  assert.equal(store.getSales()[0].sync, 'sent');
});

test('a sale still inside its undo window is not sent yet', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO, { holdUntil: 5000 }));
  const api = fakeApi();
  let clock = 1000;
  const syncer = createSyncer({ store, getApi: () => api, now: () => clock });
  await syncer.run();
  assert.equal(api.calls.length, 0);
  assert.equal(syncer.pendingCount(), 1);
  clock = 5000;
  await syncer.run();
  assert.equal(store.getSales()[0].sync, 'sent');
});

test('cancelling a sale that was already sent sends the cancellation', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  const syncer = createSyncer({ store, getApi: () => api });
  await syncer.run();
  syncer.cancel(SALE_CREDITO.id);
  assert.equal(syncer.pendingCount(), 1);
  await syncer.run();
  assert.deepEqual(api.calls[1], { sales: [], cancels: [SALE_CREDITO.id] });
  assert.equal(store.getSales()[0].cancelSync, 'sent');
  assert.equal(syncer.pendingCount(), 0);
});

test('a sale cancelled before being sent goes out once, already cancelled', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  const syncer = createSyncer({ store, getApi: () => api });
  syncer.cancel(SALE_CREDITO.id);
  assert.equal(store.getSales()[0].cancelSync, null);
  await syncer.run();
  assert.equal(api.calls[0].sales[0].canceled, true);
  assert.deepEqual(api.calls[0].cancels, []);
  await syncer.run();
  assert.equal(api.calls.length, 1);
});

test('a sale cancelled while its send was in flight still gets its cancellation sent', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  const realSync = api.sync.bind(api);
  let syncer;
  api.sync = async (payload) => {
    const answer = await realSync(payload);
    if (payload.sales.length) syncer.cancel(SALE_CREDITO.id);
    return answer;
  };
  syncer = createSyncer({ store, getApi: () => api });
  await syncer.run();
  assert.equal(syncer.pendingCount(), 1);
  await syncer.run();
  assert.deepEqual(api.calls[1], { sales: [], cancels: [SALE_CREDITO.id] });
});

test('two runs at the same time send each sale once', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const api = fakeApi();
  const syncer = createSyncer({ store, getApi: () => api });
  await Promise.all([syncer.run(), syncer.run()]);
  assert.equal(api.calls.length, 1);
});

test('without a script link nothing is sent and nothing is lost', async () => {
  const store = createStore(memoryStorage());
  store.addSale(local(SALE_CREDITO));
  const syncer = createSyncer({ store, getApi: () => null });
  assert.deepEqual(await syncer.run(), { sent: 0, failed: 1, error: 'Falta configurar o link da planilha.' });
  assert.equal(syncer.pendingCount(), 1);
});

// ---- api ----

test('api asks for the config with the action in the query string', async () => {
  const seen = [];
  const api = createApi('https://script.example/exec', async (url, init) => { seen.push([url, init.method]); return jsonResponse({ ok: true, products: [], fees: [] }); });
  await api.getConfig();
  await api.getDay('2026-11-15');
  assert.deepEqual(seen, [
    ['https://script.example/exec?action=config', 'GET'],
    ['https://script.example/exec?action=day&date=2026-11-15', 'GET'],
  ]);
});

test('api posts the sync as plain text so the browser sends no preflight', async () => {
  let seen;
  const api = createApi('https://script.example/exec', async (url, init) => { seen = init; return jsonResponse({ ok: true, saved: [] }); });
  await api.sync({ sales: [SALE_CREDITO], cancels: [] });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(seen.body), { action: 'sync', sales: [SALE_CREDITO], cancels: [] });
});

test('an HTML page instead of data becomes an error that says what to check', async () => {
  const api = createApi('https://script.example/exec', async () => ({ text: async () => '<!DOCTYPE html><html>Sign in</html>' }));
  await assert.rejects(api.getConfig(), /Qualquer pessoa/);
});

test('an error reported by the script is passed on', async () => {
  const api = createApi('https://script.example/exec', async () => jsonResponse({ ok: false, error: 'Aba "Taxas" não encontrada na planilha.' }));
  await assert.rejects(api.getConfig(), /Taxas/);
});

test('no network becomes a plain "no connection" error', async () => {
  const api = createApi('https://script.example/exec', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.getConfig(), /Sem conexão/);
});
