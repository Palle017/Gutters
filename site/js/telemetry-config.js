// Public Gutters-only configuration. A measurement ID is public, never an OAuth secret.
// Keep off until the Gutters stream is verified, Enhanced Measurement is disabled,
// and this draft has received release approval. No fallback property is permitted.
window.GUTTERS_TELEMETRY_CONFIG = Object.freeze({
  enabled: false,
  measurementId: ''
});
