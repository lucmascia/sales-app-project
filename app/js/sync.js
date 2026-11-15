// The send queue: pushes sales made on this phone to the spreadsheet and keeps
// track of what still has to go. Safe to call at any time and as often as
// wanted — the sheet ignores sale codes it already has.

const toWire = ({ id, date, time, seller, payment, canceled, lines }) => ({ id, date, time, seller, payment, canceled, lines });

export function createSyncer({ store, getApi, now = () => Date.now() }) {
  let inFlight = null;
  let again = false;

  const isPending = (s) => s.sync === 'pending' || s.cancelSync === 'pending';
  const pendingCount = () => store.getSales().filter(isPending).length;

  async function once() {
    const all = store.getSales();
    const sales = all.filter((s) => s.sync === 'pending' && (s.holdUntil || 0) <= now());
    const cancels = all.filter((s) => s.sync === 'sent' && s.cancelSync === 'pending').map((s) => s.id);
    const attempted = sales.length + cancels.length;
    if (attempted === 0) return { sent: 0, failed: 0, error: null };

    const api = getApi();
    if (!api) return { sent: 0, failed: attempted, error: 'Falta configurar o link da planilha.' };

    let answer;
    try {
      answer = await api.sync({ sales: sales.map(toWire), cancels });
    } catch (error) {
      return { sent: 0, failed: attempted, error: error.message };
    }

    const sentAsCanceled = new Map(sales.map((s) => [s.id, s.canceled]));
    for (const id of [...(answer.saved || []), ...(answer.duplicates || [])]) {
      const current = store.getSales().find((s) => s.id === id);
      if (!current) continue;
      // Cancelled on the phone while this request was travelling: the sheet got
      // the live version, so the cancellation still has to follow.
      const cancelLater = current.canceled && !sentAsCanceled.get(id);
      store.updateSale(id, cancelLater ? { sync: 'sent', cancelSync: 'pending' } : { sync: 'sent' });
    }
    // "notFound" means the rows were removed from the sheet by hand; nothing left to cancel.
    for (const id of [...(answer.canceled || []), ...(answer.notFound || [])]) {
      store.updateSale(id, { cancelSync: 'sent' });
    }
    return { sent: attempted, failed: 0, error: null };
  }

  function run() {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      let result = await once();
      while (again && !result.error) {
        again = false;
        const next = await once();
        result = { sent: result.sent + next.sent, failed: next.failed, error: next.error };
      }
      again = false;
      return result;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Marks a sale as cancelled; the next run tells the sheet. */
  function cancel(id) {
    const sale = store.getSales().find((s) => s.id === id);
    if (!sale || sale.canceled) return;
    store.updateSale(id, sale.sync === 'sent' ? { canceled: true, cancelSync: 'pending' } : { canceled: true });
  }

  return { run, cancel, pendingCount };
}
