// Everything the phone remembers, kept in localStorage: settings, the last
// catalogue downloaded from the spreadsheet, and the sales made on this phone.
//
// A stored sale is a Sale (see calc.js) plus:
//   sync: 'pending' | 'sent'            has the sheet received it?
//   cancelSync: null | 'pending' | 'sent'  has the sheet received its cancellation?
//   holdUntil: epoch ms before which it must not be sent (the undo window)

const KEYS = { settings: 'mv.settings', config: 'mv.config', sales: 'mv.sales', dayCache: 'mv.dayCache' };
const DEFAULT_SETTINGS = { scriptUrl: '', seller: '', feePct: 10, feeFixed: 45 };
const KEEP_SENT_DAYS = 90;

export function createStore(storage) {
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(storage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  };
  // Writes are not wrapped: if the phone cannot save, the caller must know.
  const write = (key, value) => storage.setItem(key, JSON.stringify(value));

  const getSales = () => {
    const sales = read(KEYS.sales, []);
    return Array.isArray(sales) ? sales : [];
  };

  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
    saveSettings(patch) { write(KEYS.settings, { ...this.getSettings(), ...patch }); },

    getConfig: () => read(KEYS.config, null),
    saveConfig: (config) => write(KEYS.config, config),

    getSales,
    addSale(sale) { write(KEYS.sales, [...getSales(), sale]); },
    updateSale(id, patch) { write(KEYS.sales, getSales().map((s) => (s.id === id ? { ...s, ...patch } : s))); },
    removeSale(id) { write(KEYS.sales, getSales().filter((s) => s.id !== id)); },

    /** Drops sales that are safely in the sheet and older than 90 days. `today` is 'YYYY-MM-DD'. */
    prune(today) {
      const cutoff = new Date(`${today}T12:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_SENT_DAYS);
      const limit = cutoff.toISOString().slice(0, 10);
      const kept = getSales().filter((s) => s.sync !== 'sent' || s.cancelSync === 'pending' || s.date >= limit);
      if (kept.length !== getSales().length) write(KEYS.sales, kept);
    },

    getDayCache: () => read(KEYS.dayCache, null),
    saveDayCache: (cache) => write(KEYS.dayCache, cache),
  };
}
