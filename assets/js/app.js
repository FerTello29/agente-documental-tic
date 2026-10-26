// Controlador principal de Archivo TIC IA.
import { ApiClient } from './api.js';
import { Pipeline, DocumentLibrary, loadingCard, answerCard, h } from './components.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.api = new ApiClient();
    this.pipeline = new Pipeline($('pipeline'));
    this.library = new DocumentLibrary({ list: $('documents'), count: $('doc-count'), filter: $('doc-filter') });
    this.health = null;
    this.docs = [];
    this.history = [];
    this.busy = false;
  }

  async start() {
    this.bind();
    this.updateGlider();
    try { this.api.accessKey = sessionStorage.getItem('archivo-tic-key') || ''; } catch { /* sin almacenamiento */ }
    await Promise.allSettled([this.loadHealth(), this.loadDocuments()]);
    this.refreshPipeline();
  }

  bind() {
    $('ask').addEventListener('click', () => this.ask());
    $('sync').addEventListener('click', () => this.sync());
    $('question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.ask(); });
    $('question').addEventListener('input', () => { $('char-count').textContent = `${$('question').value.length} / 3000`; });
    $('suggestions').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-q]');
      if (!chip) return;
      $('question').value = chip.dataset.q;
      $('question').dispatchEvent(new Event('input'));
      $('question').focus();
    });
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => this.updateGlider()));
    window.addEventListener('resize', () => this.updateGlider());
    $('access-key').addEventListener('change', () => {
      this.api.accessKey = $('access-key').value.trim();
      try { sessionStorage.setItem('archivo-tic-key', this.api.accessKey); } catch { /* sin almacenamiento */ }
    });
    $('clear-history').addEventListener('click', () => { this.history = []; this.renderHistory(); });
  }

  get mode() { return document.querySelector('input[name="mode"]:checked').value; }

  updateGlider() {
    const label = document.querySelector('input[name="mode"]:checked + label');
    const glider = document.querySelector('.mode-glider');
    if (!label || !glider) return;
    glider.style.width = `${label.offsetWidth}px`;
    glider.style.transform = `translateX(${label.offsetLeft - 4}px)`;
  }

  message(text, kind = '') {
    $('message').textContent = text;
    $('message').className = 'message' + (kind ? ' ' + kind : '');
  }

  async loadHealth() {
    const pills = Object.fromEntries([...document.querySelectorAll('.status-pill')].map((p) => [p.dataset.key, p]));
    try {
      const r = await this.api.health();
      this.health = r;
      pills.server.className = 'status-pill ok';
      pills.openai.className = 'status-pill ' + (r.openai ? 'ok' : 'bad');
      pills.vector_store.className = 'status-pill ' + (r.vector_store ? 'ok' : 'warn');
      const env = r.environment === 'vercel' ? 'Vercel' : 'Localhost';
      $('env-pill').textContent = env;
      $('stat-env').textContent = env;
      $('stat-model').textContent = r.model || '—';
      if (!r.sync_enabled) {
        $('sync').disabled = true;
        $('sync').querySelector('span').textContent = 'Sincronización solo en localhost';
        $('sync-note').textContent = 'En Vercel el índice es de solo lectura: se sincroniza en el equipo local con OAuth y se publica el manifiesto como variable de entorno.';
      }
      if (r.access_key_required) $('access-field').classList.remove('d-none');
      if (!r.openai) this.message('Configuración pendiente: falta OPENAI_API_KEY en el servidor.', 'error');
    } catch {
      pills.server.className = 'status-pill bad';
      $('env-pill').textContent = 'Sin conexión';
      this.message('No hay conexión con el servidor. Ejecuta python app.py.', 'error');
    }
  }

  async loadDocuments() {
    try {
      const r = await this.api.documents();
      this.docs = r.documents;
      this.library.set(r.documents);
      $('stat-docs').textContent = String(r.indexed);
    } catch (e) {
      this.library.set([]);
      this.message(e.message, 'error');
    }
  }

  refreshPipeline() {
    const r = this.health || {};
    const ready = [];
    if (r.drive_folder || this.docs.length) ready.push('drive');
    if (this.docs.length) ready.push('sync');
    if (r.vector_store) ready.push('store', 'search');
    if (r.openai) ready.push('model');
    this.pipeline.setReady(ready);
  }

  async ask() {
    if (this.busy) return;
    const question = $('question').value.trim();
    if (question.length < 3) { this.message('Escribe una pregunta de al menos 3 caracteres.', 'error'); $('question').focus(); return; }
    if (!$('access-field').classList.contains('d-none')) this.api.accessKey = $('access-key').value.trim() || this.api.accessKey;

    const mode = this.mode;
    const runs = mode === 'compare' ? [false, true] : [mode === 'rag'];
    const results = $('results');
    results.className = 'results' + (runs.length > 1 ? ' compare' : '');
    const placeholders = runs.map((useSearch) => loadingCard(useSearch));
    results.replaceChildren(...placeholders);

    this.setBusy(true);
    this.pipeline.run(runs.includes(true));
    this.message(runs.length > 1 ? 'Ejecutando experimento A (sin File Search) y B (con File Search)…' : 'Consultando al agente…');

    const outcomes = await Promise.all(runs.map(async (useSearch, i) => {
      const t0 = performance.now();
      try {
        const data = await this.api.ask(question, useSearch);
        const card = answerCard({ question, useSearch, data, ms: performance.now() - t0, docs: this.docs });
        placeholders[i].replaceWith(card);
        return { useSearch, data };
      } catch (e) {
        if (e.status === 401) $('access-field').classList.remove('d-none');
        placeholders[i].replaceWith(answerCard({ question, useSearch, error: e.message, ms: performance.now() - t0 }));
        return { useSearch, error: e.message };
      }
    }));

    const ok = outcomes.every((o) => !o.error);
    this.pipeline.finish(runs.includes(true), ok);
    const cited = outcomes.flatMap((o) => o.data?.sources || []);
    this.library.highlight(cited);
    this.message(ok ? `Consulta finalizada${cited.length ? ` · ${cited.length} cita(s) verificables` : ''}.` : outcomes.find((o) => o.error).error, ok ? 'ok' : 'error');
    this.setBusy(false);

    this.history.unshift({ question, mode, outcomes, at: new Date() });
    this.history = this.history.slice(0, 12);
    this.renderHistory();
    setTimeout(() => this.refreshPipeline(), 2600);
  }

  setBusy(busy) {
    this.busy = busy;
    $('ask').disabled = busy;
    $('ask').classList.toggle('busy', busy);
    $('ask').querySelector('.label').textContent = busy ? 'Consultando' : 'Consultar';
  }

  renderHistory() {
    $('history-panel').classList.toggle('d-none', !this.history.length);
    $('stat-queries').textContent = String(this.history.length);
    const labels = { rag: 'RAG', plain: 'Sin RAG', compare: 'A/B' };
    $('history').replaceChildren(...this.history.map((item) => {
      const btn = h('button', { type: 'button', title: item.question },
        h('span', { class: 'meta-tag', text: labels[item.mode] }),
        h('span', { class: 'q', text: item.question }),
        h('span', { class: 't', text: item.at.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) }));
      btn.addEventListener('click', () => this.showFromHistory(item));
      return h('li', {}, btn);
    }));
  }

  showFromHistory(item) {
    const results = $('results');
    results.className = 'results' + (item.outcomes.length > 1 ? ' compare' : '');
    results.replaceChildren(...item.outcomes.map((o) => answerCard({ question: item.question, useSearch: o.useSearch, data: o.data, error: o.error, docs: this.docs })));
    $('question').value = item.question;
    $('question').dispatchEvent(new Event('input'));
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async sync() {
    if (!confirm('¿Sincronizar los archivos de la carpeta autorizada de Google Drive?')) return;
    const btn = $('sync');
    btn.disabled = true;
    btn.classList.add('busy');
    btn.querySelector('span').textContent = 'Sincronizando…';
    this.pipeline.reset();
    ['drive', 'sync', 'store'].forEach((s) => { this.pipeline.items[s].className = 'active'; });
    this.message('Sincronizando documentos. Si es la primera vez, autoriza el acceso de solo lectura en la ventana de Google.');
    try {
      const r = await this.api.sync();
      const s = r.stats;
      $('sync-stats').replaceChildren(
        ...[['nuevos', s.added], ['actualizados', s.updated], ['eliminados', s.removed], ['sin cambios', s.unchanged], ['errores', s.errors.length]]
          .map(([k, v]) => h('span', {}, h('b', { text: String(v) }), ' ' + k)));
      await Promise.allSettled([this.loadHealth(), this.loadDocuments()]);
      this.message(s.errors.length ? `Sincronización con ${s.errors.length} error(es): ${s.errors.map((e) => e.file).join(', ')}` : 'Sincronización completada.', s.errors.length ? 'error' : 'ok');
    } catch (e) {
      this.message(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.querySelector('span').textContent = 'Sincronizar desde Drive';
      this.refreshPipeline();
    }
  }
}

new App().start();
