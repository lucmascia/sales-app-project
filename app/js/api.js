// Talks to the spreadsheet script (a Google Apps Script web app).
//
// The POST body is sent as text/plain on purpose: that keeps it a "simple"
// cross-origin request, so the browser sends no preflight, which Apps Script
// cannot answer.

const TIMEOUT_MS = 25000;

export function createApi(scriptUrl, fetchImpl = (...args) => fetch(...args)) {
  async function call(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let text;
    try {
      const response = await fetchImpl(url, { ...init, redirect: 'follow', signal: controller.signal });
      text = await response.text();
    } catch (error) {
      throw new Error(controller.signal.aborted
        ? 'A planilha demorou demais para responder.'
        : 'Sem conexão com a planilha.');
    } finally {
      clearTimeout(timer);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('O link respondeu com uma página em vez de dados. Confira se o script foi publicado '
        + 'com acesso "Qualquer pessoa" e se o link termina em /exec.');
    }
    if (!data || data.ok !== true) throw new Error((data && data.error) || 'A planilha recusou o pedido.');
    return data;
  }

  const withQuery = (query) => scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + query;

  return {
    getConfig: () => call(withQuery('action=config'), { method: 'GET' }),
    getDay: (date) => call(withQuery(`action=day&date=${encodeURIComponent(date)}`), { method: 'GET' }),
    sync: ({ sales, cancels }) => call(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'sync', sales, cancels }),
    }),
  };
}
