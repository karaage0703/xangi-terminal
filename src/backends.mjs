// Endpoints and credentials are configured only on the server.
export function configuredBackends(config) {
  const entries = config.backends || [{ id: 'default', name: '既定のLLM', llmUrl: config.llmUrl, model: config.model, apiKey: config.apiKey, disableThinking: config.disableThinking }];
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw Error('LLM_BACKENDS_JSON must contain 1–20 backends');
  const ids = new Set();
  for (const b of entries) {
    if (!b || typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(b.id) || ids.has(b.id) || typeof b.name !== 'string' || !b.name || typeof b.model !== 'string' || !b.model) throw Error('Invalid backend configuration');
    ids.add(b.id);
    const u = new URL(b.llmUrl);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('Invalid backend URL');
  }
  return entries;
}
