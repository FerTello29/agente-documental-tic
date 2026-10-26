import { API_ROOT } from './config.js';

/** Cliente HTTP del backend. El navegador nunca recibe ni envía la OPENAI_API_KEY. */
export class ApiClient {
  constructor() {
    this.accessKey = '';
  }

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.accessKey) headers['X-Access-Key'] = this.accessKey;
    const response = await fetch(API_ROOT + path, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch { /* respuesta sin JSON */ }
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`;
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  health() { return this.request('/api/health'); }
  documents() { return this.request('/api/documents'); }
  sync() { return this.request('/api/sync', { method: 'POST' }); }
  ask(question, useSearch) {
    return this.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, use_search: useSearch }),
    });
  }
}
