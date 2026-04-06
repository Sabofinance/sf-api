import { syncFxRates } from './fx-rate-sync.worker';

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Run once immediately on startup, then every 15 minutes
syncFxRates().catch((err) => console.error('[fx-rate-sync] initial sync error:', err));

setInterval(() => {
  syncFxRates().catch((err) => console.error('[fx-rate-sync] error:', err));
}, INTERVAL_MS);
