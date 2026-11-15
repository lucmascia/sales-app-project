// The three screens (Vender, Fechamento, Ajustes) and the glue between them.
// All arithmetic lives in calc.js and summary.js; all persistence in store.js.
import { buildSale, newSaleId, parseMoney } from './calc.js';
import { summarize, mergeRows } from './summary.js';
import { createStore } from './store.js';
import { createApi } from './api.js';
import { createSyncer } from './sync.js';

const APP_VERSION = '1.0.0';
const UNDO_MS = 6000;               // how long "Desfazer" stays, and how long a sale waits before being sent
const RETRY_MS = 30000;             // while something is pending, try again this often
const CONFIG_MAX_AGE_MS = 10 * 60 * 1000;

const $ = (selector) => document.querySelector(selector);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const productKey = (p) => `${p.produto}|${p.tamanho}`;
const productLabel = (p) => (String(p.tamanho) === 'Unico' ? p.produto : `${p.produto} ${p.tamanho}`);
const paymentLabel = (chave) => chave.split(' - ').pop();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let store;
try {
  store = createStore(window.localStorage);
  store.getSettings();
} catch (error) {
  document.body.innerHTML = '<p style="padding:24px;font:600 18px system-ui">Este navegador não deixa o app guardar dados '
    + '(modo privado?). Abra em uma aba normal para usar o Manticello Vendas.</p>';
  throw error;
}

const getApi = () => {
  const { scriptUrl } = store.getSettings();
  return scriptUrl ? createApi(scriptUrl) : null;
};
const syncer = createSyncer({ store, getApi });

const state = {
  view: 'sell',
  cart: new Map(),        // productKey -> quantity
  finalTotal: null,       // what the customer pays when a discount was given
  lastSale: null,         // { id, detail } of the sale that can still be undone
  closingDate: today(),
  serverDay: store.getDayCache(),   // { date, rows, fetchedAt } as last read from the sheet
  closingError: null,
  syncError: null,
};

// ---------- toast ----------

let toastTimer = null;
function toast(text, ms = 3000) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

// ---------- navigation ----------

function show(view) {
  state.view = view;
  for (const name of ['sell', 'closing', 'settings']) $(`#view-${name}`).hidden = name !== view;
  document.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  if (view === 'sell') renderSell();
  if (view === 'settings') renderSettings();
  if (view === 'closing') {
    state.closingDate = today();
    $('#closing-date').value = state.closingDate;
    renderClosing();
    refreshClosing();
  }
}

// ---------- sending ----------

function renderStatus() {
  const pending = syncer.pendingCount();
  const button = $('#sync-status');
  button.dataset.pending = String(pending);
  button.textContent = pending ? `↑ ${pending}` : '✓';
  button.setAttribute('aria-label', pending ? `${plural(pending, 'venda', 'vendas')} para enviar. Toque para enviar agora.` : 'Tudo enviado');
  button.classList.toggle('offline', navigator.onLine === false);
  const line = $('#settings-pending');
  line.textContent = pending
    ? `${plural(pending, 'venda aguardando', 'vendas aguardando')} envio.${state.syncError ? ` Último erro: ${state.syncError}` : ''}`
    : 'Todas as vendas deste celular já estão na planilha.';
  line.className = `status ${pending && state.syncError ? 'bad' : ''}`;
}

async function syncNow({ announce = false } = {}) {
  const result = await syncer.run();
  state.syncError = result.error;
  renderStatus();
  if (state.view === 'closing') renderClosing();
  if (announce) {
    if (result.error) toast(`Não foi possível enviar: ${result.error}`, 5000);
    else toast(result.sent ? 'Vendas enviadas para a planilha.' : 'Nada para enviar.');
  }
  return result;
}

async function refreshConfig() {
  const api = getApi();
  if (!api) return null;
  const { products, fees, warnings } = await api.getConfig();
  const config = { products, fees, warnings: warnings || [], fetchedAt: Date.now() };
  store.saveConfig(config);
  return config;
}

function refreshConfigIfStale() {
  const config = store.getConfig();
  if (!getApi() || navigator.onLine === false) return;
  if (config && Date.now() - config.fetchedAt < CONFIG_MAX_AGE_MS) return;
  if (state.cart.size > 0) return; // prices must never change under a half-built sale
  refreshConfig().then(() => { if (state.view === 'sell' && state.cart.size === 0) renderSell(); }).catch(() => {});
}

// ---------- Vender ----------

function cartItems() {
  const config = store.getConfig();
  if (!config) return [];
  return config.products
    .filter((p) => state.cart.has(productKey(p)))
    .map((p) => ({ ...p, qty: state.cart.get(productKey(p)) }));
}

function renderSell() {
  const config = store.getConfig();
  const ready = Boolean(config && config.products.length && store.getSettings().seller);
  $('#sell-empty').hidden = ready;
  $('#products').hidden = !ready;
  document.querySelector('.checkout').hidden = !ready;
  if (!ready) return;

  const families = [...new Set(config.products.map((p) => p.produto))];
  $('#products').innerHTML = config.products.map((p) => {
    const qty = state.cart.get(productKey(p)) || 0;
    const size = String(p.tamanho) === 'Unico' ? '' : `<span class="size">${esc(p.tamanho)}</span>`;
    const label = `${productLabel(p)}, ${brl(p.preco)}${qty ? `, ${qty} no carrinho` : ''}`;
    return `<button type="button" class="product tile-${families.indexOf(p.produto) % 6}" data-key="${esc(productKey(p))}" aria-label="${esc(label)}">
      <span class="name">${esc(p.produto)}</span>${size}
      <span class="price">${brl(p.preco)}</span>
      ${qty ? `<span class="qty">${qty}</span>` : ''}
    </button>`;
  }).join('');

  $('#payments').innerHTML = config.fees.map((fee) =>
    `<button type="button" class="payment" data-key="${esc(fee.chave)}">${esc(paymentLabel(fee.chave))}</button>`).join('');

  renderCart();
}

function renderCart() {
  const items = cartItems();
  const gross = items.reduce((sum, item) => sum + item.preco * item.qty, 0);
  $('#cart').innerHTML = items.map((item) => `<li class="cart-line">
      <span class="what">${item.qty}× ${esc(productLabel(item))}</span>
      <span class="amount">${brl(item.preco * item.qty)}</span>
      <button type="button" class="cart-minus" data-key="${esc(productKey(item))}" aria-label="Tirar 1 ${esc(productLabel(item))}">−</button>
    </li>`).join('');

  const total = $('#cart-total');
  const empty = items.length === 0;
  total.disabled = empty;
  if (state.finalTotal !== null && !empty) {
    total.innerHTML = `Total <span class="was">${brl(gross)}</span>${brl(state.finalTotal)}<small>desconto de ${brl(gross - state.finalTotal)} · toque para mudar</small>`;
  } else {
    total.innerHTML = `Total ${brl(gross)}${empty ? '' : '<small>toque para dar desconto</small>'}`;
  }
  $('#cart-clear').hidden = empty;
  // Right after a sale the total row has nothing to say; "Desfazer" borrows its place.
  const justSold = empty && state.lastSale !== null;
  $('#sale-done').hidden = !justSold;
  document.querySelector('.total-row').hidden = justSold;
  if (justSold) $('#sale-done-detail').textContent = state.lastSale.detail;
  document.querySelectorAll('.payment').forEach((button) => { button.disabled = empty; });

  document.querySelectorAll('.product').forEach((button) => {
    const qty = state.cart.get(button.dataset.key) || 0;
    let badge = button.querySelector('.qty');
    if (qty && !badge) { badge = document.createElement('span'); badge.className = 'qty'; button.append(badge); }
    if (badge) { if (qty) badge.textContent = String(qty); else badge.remove(); }
  });
}

function changeCart(key, delta) {
  const qty = (state.cart.get(key) || 0) + delta;
  if (qty > 0) state.cart.set(key, qty); else state.cart.delete(key);
  if (state.finalTotal !== null) {
    state.finalTotal = null; // the agreed value was for the cart as it was
    toast('Carrinho mudou: desconto removido.');
  }
  renderCart();
}

function clearCart() {
  state.cart.clear();
  state.finalTotal = null;
  renderCart();
}

let lastSaleTimer = null;
function concludeSale(paymentKey) {
  const items = cartItems();
  if (items.length === 0) return; // also what makes a double tap harmless
  const fee = store.getConfig().fees.find((f) => f.chave === paymentKey);
  if (!fee) return;
  const now = new Date();
  let sale;
  try {
    sale = buildSale({ cart: items, payment: fee, finalTotal: state.finalTotal, seller: store.getSettings().seller, now, id: newSaleId(now) });
    store.addSale({ ...sale, sync: 'pending', cancelSync: null, holdUntil: Date.now() + UNDO_MS });
  } catch (error) {
    window.alert(`A venda NÃO foi registrada neste celular.\n\n${error.message}\n\nAnote esta venda no papel.`);
    return;
  }
  const charged = sale.lines.reduce((sum, line) => sum + line.cobrado, 0);
  state.lastSale = { id: sale.id, detail: `${brl(charged)} · ${paymentLabel(sale.payment)}` };
  clearCart();
  renderStatus();
  clearTimeout(lastSaleTimer);
  lastSaleTimer = setTimeout(() => { state.lastSale = null; renderCart(); }, UNDO_MS);
  setTimeout(() => syncNow(), UNDO_MS + 50);
}

function undoLastSale() {
  if (!state.lastSale) return;
  const { id } = state.lastSale;
  clearTimeout(lastSaleTimer);
  state.lastSale = null;
  renderCart();
  const sale = store.getSales().find((s) => s.id === id);
  if (!sale) return;
  if (sale.sync === 'pending') store.removeSale(id); // never left the phone: no trace needed
  else syncer.cancel(id);
  renderStatus();
  toast('Venda desfeita.');
  if (sale.sync !== 'pending') syncNow();
}

function openDiscount() {
  const items = cartItems();
  if (items.length === 0) return;
  const gross = items.reduce((sum, item) => sum + item.preco * item.qty, 0);
  $('#discount-hint').textContent = `Total sem desconto: ${brl(gross)}. Digite quanto o cliente vai pagar.`;
  $('#discount-input').value = '';
  $('#discount-input').placeholder = gross.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  $('#discount-error').textContent = '';
  $('#discount-remove').hidden = state.finalTotal === null;
  $('#discount-dialog').showModal();
  $('#discount-input').focus();
}

function applyDiscount(event) {
  event.preventDefault();
  const gross = cartItems().reduce((sum, item) => sum + item.preco * item.qty, 0);
  const value = parseMoney($('#discount-input').value);
  if (value === null) { $('#discount-error').textContent = 'Digite um valor, por exemplo 250 ou 250,50.'; return; }
  if (value > gross) { $('#discount-error').textContent = `O valor final não pode ser maior que ${brl(gross)}.`; return; }
  state.finalTotal = value === gross ? null : value;
  $('#discount-dialog').close();
  renderCart();
}

// ---------- Fechamento ----------

function closingRows() {
  const date = state.closingDate;
  const server = state.serverDay && state.serverDay.date === date ? state.serverDay : null;
  const local = store.getSales().filter((s) => s.date === date);
  return { rows: mergeRows(server ? server.rows : [], local), server, local };
}

function renderFeiraCost(summary) {
  document.querySelector('[data-total="feira"]').textContent = brl(summary.feiraCost);
}

function renderClosing() {
  const settings = store.getSettings();
  const { rows, server, local } = closingRows();
  const summary = summarize(rows, settings);
  const pending = syncer.pendingCount();
  const hhmm = (time) => time.slice(0, 5);

  const notices = [];
  if (pending) notices.push(`<p class="banner warn">⚠ ${plural(pending, 'venda deste celular ainda não foi enviada', 'vendas deste celular ainda não foram enviadas')} para a planilha.</p>`);
  if (state.closingError) notices.push(`<p class="banner bad">Não foi possível ler a planilha: ${esc(state.closingError)}</p>`);
  if (!server) {
    notices.push('<p class="banner warn">Só as vendas deste celular. Toque em “Atualizar” com sinal para incluir as do outro celular.</p>');
  } else {
    const read = new Date(server.fetchedAt);
    const last = Object.entries(summary.lastBySeller).map(([seller, time]) => `${esc(seller)} ${hhmm(time)}`).join(' · ');
    notices.push(`<p class="banner">Planilha lida às ${pad(read.getHours())}:${pad(read.getMinutes())}.${last ? ` Última venda de cada um: ${last}.` : ''} O fechamento só está completo quando os dois celulares tiverem enviado tudo.</p>`);
  }
  $('#closing-notices').innerHTML = notices.join('');

  const paymentRows = summary.byPayment.map((p) => `<tr><td>${esc(paymentLabel(p.chave))}</td><td>${p.vendas}</td><td>${brl(p.cobrado)}</td><td>${brl(p.taxa)}</td><td>${brl(p.liquido)}</td></tr>`).join('');
  const productRows = summary.byProduct.map((p) => `<tr><td>${esc(productLabel(p))}</td><td>${p.unidades}</td><td>${brl(p.liquido)}</td></tr>`).join('');
  $('#closing-totals').innerHTML = `
    <div class="card totals">
      <div class="big"><span>Cobrado</span><strong data-total="cobrado">${brl(summary.cobrado)}</strong></div>
      <div class="big"><span>Líquido</span><strong data-total="liquido">${brl(summary.liquido)}</strong></div>
      <div><span>Vendas</span><strong data-total="vendas">${summary.salesCount}</strong></div>
      <div><span>Taxas</span><strong data-total="taxas">${brl(summary.taxas)}</strong></div>
      <div><span>Descontos</span><strong data-total="descontos">${brl(summary.descontos)}</strong></div>
    </div>
    <div class="card"><h2>Por forma de pagamento</h2>
      ${paymentRows ? `<table><thead><tr><th>Forma</th><th>Vendas</th><th>Cobrado</th><th>Taxa</th><th>Líquido</th></tr></thead><tbody>${paymentRows}</tbody></table>` : '<p class="hint">Nenhuma venda neste dia.</p>'}
    </div>
    <div class="card"><h2>Por produto</h2>
      ${productRows ? `<table><thead><tr><th>Produto</th><th>Unidades</th><th>Líquido</th></tr></thead><tbody>${productRows}</tbody></table>` : '<p class="hint">Nenhuma venda neste dia.</p>'}
    </div>`;
  renderFeiraCost(summary);

  const mine = new Map(local.map((s) => [s.id, s]));
  const sales = summary.sales.map((sale) => {
    const own = mine.get(sale.id);
    const items = sale.items.map((i) => `${sale.canceled ? '' : `${i.unidade}× `}${esc(productLabel(i))}`).join(', ');
    const extra = [];
    if (!sale.canceled && sale.desconto > 0) extra.push(`desconto ${brl(sale.desconto)}`);
    if (!sale.canceled && sale.taxa > 0) extra.push(`taxa ${brl(sale.taxa)} · líquido ${brl(sale.liquido)}`);
    const tags = [
      sale.canceled ? '<span class="tag cancel">Cancelada</span>' : '',
      own && (own.sync === 'pending' || own.cancelSync === 'pending') ? '<span class="tag">não enviada</span>' : '',
    ].join('');
    return `<div class="sale ${sale.canceled ? 'canceled' : ''}">
      <div class="sale-top"><span class="time">${esc(sale.time)}</span><span class="pay">${esc(sale.seller)} · ${esc(paymentLabel(sale.payment))}${tags}</span><span class="value">${brl(sale.cobrado)}</span></div>
      <div class="sale-items">${items}</div>
      <div class="sale-foot">
        <div class="sale-extra">${extra.join(' · ')}</div>
        ${own && !sale.canceled ? `<button type="button" class="cancel-sale" data-id="${esc(sale.id)}" data-what="${esc(`${sale.time} · ${brl(sale.cobrado)}`)}" aria-label="Cancelar venda das ${esc(sale.time)}">Cancelar</button>` : ''}
      </div>
    </div>`;
  }).join('');
  $('#closing-sales').innerHTML = `<div class="card"><h2>Vendas — para conferir com o extrato</h2>${sales || '<p class="hint">Nenhuma venda neste dia.</p>'}</div>`;
}

async function refreshClosing({ announce = false } = {}) {
  const api = getApi();
  const date = state.closingDate;
  if (!api) return;
  const button = $('#closing-refresh');
  button.disabled = true;
  try {
    const { rows } = await api.getDay(date);
    state.serverDay = { date, rows, fetchedAt: Date.now() };
    state.closingError = null;
    store.saveDayCache(state.serverDay);
  } catch (error) {
    state.closingError = error.message;
    if (announce) toast(`Não foi possível ler a planilha: ${error.message}`, 5000);
  } finally {
    button.disabled = false;
  }
  if (state.view === 'closing' && state.closingDate === date) renderClosing();
}

function cancelSale(button) {
  if (!window.confirm(`Cancelar a venda das ${button.dataset.what}?\n\nEla continua na planilha, marcada como cancelada e com valores zerados.`)) return;
  syncer.cancel(button.dataset.id);
  renderStatus();
  renderClosing();
  syncNow();
}

function saveFeiraCost() {
  const pct = parseMoney($('#fee-pct').value);
  const fixed = parseMoney($('#fee-fixed').value);
  if (pct === null || fixed === null) return; // mid-typing; keep the last good values
  store.saveSettings({ feePct: pct, feeFixed: fixed });
  renderFeiraCost(summarize(closingRows().rows, store.getSettings()));
}

// ---------- Ajustes ----------

function renderSettings() {
  const settings = store.getSettings();
  $('#script-url').value = settings.scriptUrl;
  $('#seller-name').value = settings.seller;
  $('#app-version').textContent = `Manticello Vendas ${APP_VERSION}`;
  $('#share-card').hidden = !settings.scriptUrl;
  if (settings.scriptUrl) {
    $('#share-link').value = `${location.origin}${location.pathname}#setup=${encodeURIComponent(settings.scriptUrl)}`;
  }
  renderStatus();
}

function setSettingsStatus(text, kind = '') {
  const status = $('#settings-status');
  status.textContent = text;
  status.className = `status ${kind}`;
}

async function saveSettings() {
  const typed = $('#script-url').value.trim();
  // On an iPhone the home-screen app starts blank, so the setup link gets pasted here instead of opened.
  const scriptUrl = scriptUrlFromSetupLink(typed) || typed;
  const seller = $('#seller-name').value.trim();
  if (!scriptUrl) { setSettingsStatus('Cole o link do script da planilha.', 'bad'); return; }
  if (!seller) { setSettingsStatus('Escreva o nome de quem vende neste celular.', 'bad'); return; }
  store.saveSettings({ scriptUrl, seller });
  renderSettings();
  setSettingsStatus('Testando a conexão…');
  const button = $('#save-settings');
  button.disabled = true;
  try {
    const config = await refreshConfig();
    const warnings = config.warnings.length ? ` Atenção: ${config.warnings.join('; ')}.` : '';
    setSettingsStatus(`Conectado: ${plural(config.products.length, 'produto', 'produtos')} e ${plural(config.fees.length, 'forma de pagamento', 'formas de pagamento')}.${warnings}`, config.warnings.length ? 'bad' : 'ok');
    syncNow();
  } catch (error) {
    setSettingsStatus(error.message, 'bad');
  } finally {
    button.disabled = false;
  }
}

// A link like …/#setup=<script link> connects a second phone without typing.
// Returns the script link inside such a setup link, or null.
function scriptUrlFromSetupLink(text) {
  const match = /#setup=(.+)$/.exec(text);
  if (!match) return null;
  try {
    const scriptUrl = decodeURIComponent(match[1]);
    return /^https?:\/\//.test(scriptUrl) ? scriptUrl : null;
  } catch {
    return null;
  }
}

function takeSetupLink() {
  if (!location.hash.startsWith('#setup=')) return false;
  const scriptUrl = scriptUrlFromSetupLink(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!scriptUrl) return false;
  store.saveSettings({ scriptUrl });
  return true;
}

async function copyShareLink() {
  const link = $('#share-link').value;
  try {
    if (navigator.share) await navigator.share({ title: 'Manticello Vendas', url: link });
    else { await navigator.clipboard.writeText(link); toast('Link copiado.'); }
  } catch {
    $('#share-link').select();
    toast('Selecione e copie o link acima.');
  }
}

// ---------- wiring ----------

function init() {
  const cameFromSetupLink = takeSetupLink();
  store.prune(today());
  const settings = store.getSettings();
  $('#fee-pct').value = String(settings.feePct).replace('.', ',');
  $('#fee-fixed').value = String(settings.feeFixed).replace('.', ',');

  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.view) show(target.dataset.view);
    else if (target.classList.contains('product')) changeCart(target.dataset.key, +1);
    else if (target.classList.contains('cart-minus')) changeCart(target.dataset.key, -1);
    else if (target.classList.contains('payment')) concludeSale(target.dataset.key);
    else if (target.classList.contains('cancel-sale')) cancelSale(target);
  });
  $('#cart-total').addEventListener('click', openDiscount);
  $('#cart-clear').addEventListener('click', clearCart);
  $('#sale-undo').addEventListener('click', undoLastSale);
  $('#discount-form').addEventListener('submit', applyDiscount);
  $('#discount-remove').addEventListener('click', () => { state.finalTotal = null; $('#discount-dialog').close(); renderCart(); });
  $('#discount-close').addEventListener('click', () => $('#discount-dialog').close());
  $('#sync-status').addEventListener('click', () => syncNow({ announce: true }));
  $('#send-now').addEventListener('click', () => syncNow({ announce: true }));
  $('#save-settings').addEventListener('click', saveSettings);
  $('#share-copy').addEventListener('click', copyShareLink);
  $('#closing-refresh').addEventListener('click', async () => { await syncNow(); await refreshClosing({ announce: true }); });
  $('#closing-date').addEventListener('change', (event) => {
    state.closingDate = event.target.value || today();
    state.closingError = null;
    renderClosing();
    refreshClosing();
  });
  $('#fee-pct').addEventListener('input', saveFeiraCost);
  $('#fee-fixed').addEventListener('input', saveFeiraCost);

  window.addEventListener('online', () => { renderStatus(); syncNow(); refreshConfigIfStale(); });
  window.addEventListener('offline', renderStatus);
  window.addEventListener('hashchange', () => { if (takeSetupLink()) show('settings'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { syncNow(); refreshConfigIfStale(); }
  });
  setInterval(() => { if (syncer.pendingCount() > 0) syncNow(); }, RETRY_MS);

  const ready = settings.scriptUrl && settings.seller && store.getConfig();
  show(ready && !cameFromSetupLink ? 'sell' : 'settings');
  renderStatus();
  syncNow();
  refreshConfigIfStale();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
