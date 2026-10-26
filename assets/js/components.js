// Componentes de interfaz: flujo RAG, biblioteca de documentos y tarjetas de respuesta.
import { SOURCE_HOSTS } from './config.js';
import { renderMarkdown } from './markdown.js';

const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
};

/** Solo se enlazan URLs https de Google Drive/Docs; cualquier otra se muestra como texto. */
export function safeDriveUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && SOURCE_HOSTS.includes(u.hostname)) return u.href;
  } catch { /* URL inválida */ }
  return null;
}

export function fileKind(doc) {
  const mime = doc.mime_type || '';
  const name = (doc.name || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return { cls: 'pdf', label: 'PDF' };
  if (mime === 'application/vnd.google-apps.document') return { cls: 'doc', label: 'DOC' };
  return { cls: 'txt', label: 'TXT' };
}

const fileBadge = (doc) => { const k = fileKind(doc); return h('span', { class: `file-type ${k.cls}`, text: k.label, 'aria-hidden': 'true' }); };

function relativeDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((Date.now() - date.getTime()) / 86400000);
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (Math.abs(days) < 1) return 'modificado hoy';
  if (Math.abs(days) < 30) return 'modificado ' + rtf.format(-days, 'day');
  return 'modificado el ' + date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
export class Pipeline {
  static ORDER = ['drive', 'sync', 'store', 'search', 'model'];

  constructor(root) {
    this.root = root;
    this.items = Object.fromEntries([...root.querySelectorAll('li')].map((li) => [li.dataset.stage, li]));
    this.timer = 0;
    this.ready = new Set();
  }

  setReady(stages) {
    this.ready = new Set(stages);
    this.reset();
  }

  reset() {
    clearInterval(this.timer);
    for (const [stage, li] of Object.entries(this.items)) {
      li.className = this.ready.has(stage) ? 'ready' : '';
    }
    this.root.dataset.progress = '0';
  }

  /** Anima el recorrido mientras espera la respuesta del servidor. */
  run(useSearch) {
    this.reset();
    const steps = useSearch ? ['drive', 'sync', 'store', 'search', 'model'] : ['model'];
    if (!useSearch) ['drive', 'sync', 'store', 'search'].forEach((s) => { this.items[s].className = 'skipped'; });
    let idx = 0;
    const advance = () => {
      if (idx > 0) this.items[steps[idx - 1]].className = 'done';
      if (idx < steps.length) {
        this.items[steps[idx]].className = 'active';
        if (useSearch) this.root.dataset.progress = String(Math.min(idx, 4));
        idx++;
      }
      if (idx >= steps.length) clearInterval(this.timer);
    };
    advance();
    this.timer = setInterval(advance, useSearch ? 520 : 300);
  }

  finish(useSearch, ok = true) {
    clearInterval(this.timer);
    for (const stage of Pipeline.ORDER) {
      const li = this.items[stage];
      if (!useSearch && stage !== 'model') li.className = 'skipped';
      else li.className = ok ? 'done' : (this.ready.has(stage) ? 'ready' : '');
    }
    this.root.dataset.progress = ok && useSearch ? '4' : '0';
  }
}

/* ------------------------------------------------------------------ */
export class DocumentLibrary {
  constructor({ list, count, filter }) {
    this.list = list;
    this.count = count;
    this.filter = filter;
    this.docs = [];
    this.cited = new Set();
    filter.addEventListener('input', () => this.render());
  }

  set(docs) {
    this.docs = [...docs].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    this.count.textContent = String(this.docs.length);
    this.render();
  }

  highlight(sources) {
    this.cited = new Set(sources.map((s) => s.name));
    this.render();
  }

  render() {
    const q = this.filter.value.trim().toLowerCase();
    const docs = this.docs.filter((d) => d.name.toLowerCase().includes(q));
    this.list.replaceChildren();
    if (!this.docs.length) {
      this.list.append(h('div', { class: 'doc-empty' }, h('i', { class: 'bi bi-inboxes' }),
        'Aún no hay documentos indexados. Sincroniza la carpeta de Drive para crear el índice.'));
      return;
    }
    if (!docs.length) {
      this.list.append(h('div', { class: 'doc-empty', text: 'Ningún documento coincide con el filtro.' }));
      return;
    }
    docs.forEach((doc, i) => {
      const url = safeDriveUrl(doc.url);
      const name = url
        ? h('a', { class: 'doc-name', href: url, target: '_blank', rel: 'noopener noreferrer', text: doc.name })
        : h('span', { class: 'doc-name', text: doc.name });
      const item = h('div', { class: 'doc' + (this.cited.has(doc.name) ? ' cited' : ''), style: `animation-delay:${i * 40}ms` },
        fileBadge(doc),
        h('div', { class: 'doc-body' }, name, h('span', { class: 'doc-meta', text: [fileKind(doc).label, relativeDate(doc.modified_time)].filter(Boolean).join(' · ') })),
        url ? h('i', { class: 'bi bi-box-arrow-up-right doc-open', 'aria-hidden': 'true' }) : null);
      this.list.append(item);
    });
  }
}

/* ------------------------------------------------------------------ */
export function loadingCard(useSearch) {
  return h('article', { class: `glass answer-card ${useSearch ? 'rag' : 'plain'}` },
    h('div', { class: 'answer-head' }, modeTag(useSearch), h('span', { class: 'meta-tag', text: 'consultando…' })),
    h('div', { class: 'skeleton', 'aria-label': 'Cargando respuesta' }, h('i'), h('i'), h('i'), h('i'), h('i')));
}

function modeTag(useSearch) {
  return useSearch
    ? h('span', { class: 'mode-tag rag' }, h('i', { class: 'bi bi-database-check' }), 'B · Con File Search (RAG)')
    : h('span', { class: 'mode-tag plain' }, h('i', { class: 'bi bi-cpu' }), 'A · Sin File Search');
}

export function answerCard({ question, useSearch, data, error, ms, docs }) {
  const card = h('article', { class: `glass answer-card ${useSearch ? 'rag' : 'plain'}` });
  const copy = h('button', { type: 'button', class: 'copy-btn', title: 'Copiar respuesta', 'aria-label': 'Copiar respuesta' }, h('i', { class: 'bi bi-clipboard' }));
  const head = h('div', { class: 'answer-head' }, modeTag(useSearch),
    ms != null ? h('span', { class: 'meta-tag', text: `${(ms / 1000).toFixed(1)} s` }) : null,
    data ? h('span', { class: 'meta-tag', text: `${data.sources.length} fuente${data.sources.length === 1 ? '' : 's'}` }) : null,
    data ? copy : null);
  card.append(head, h('p', { class: 'answer-question', text: question }));

  if (error) {
    card.append(h('div', { class: 'no-sources', text: error }));
    return card;
  }

  const body = h('div', { class: 'answer' });
  body.innerHTML = renderMarkdown(data.answer || 'Sin respuesta.'); // HTML ya escapado en renderMarkdown
  card.append(body);

  copy.addEventListener('click', async () => {
    const icon = copy.firstChild;
    try { await navigator.clipboard.writeText(data.answer || ''); icon.className = 'bi bi-clipboard-check'; }
    catch { icon.className = 'bi bi-clipboard-x'; }
    setTimeout(() => { icon.className = 'bi bi-clipboard'; }, 1600);
  });

  const byName = Object.fromEntries((docs || []).map((d) => [d.name, d]));
  const sources = h('div', { class: 'sources' }, h('h4', {}, h('i', { class: 'bi bi-patch-check' }), 'Fuentes verificables'));
  if (data.sources.length) {
    const list = h('ul', { class: 'source-list' });
    data.sources.forEach((s, i) => {
      const url = safeDriveUrl(s.url);
      const doc = byName[s.name] || { name: s.name };
      list.append(h('li', { class: 'source', style: `animation-delay:${i * 60}ms` }, fileBadge(doc),
        url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: s.name }) : h('span', { class: 'name', text: s.name }),
        url ? h('i', { class: 'bi bi-box-arrow-up-right', 'aria-hidden': 'true' }) : null));
    });
    sources.append(list);
  } else {
    sources.append(h('div', { class: 'no-sources', text: useSearch
      ? 'El modelo no devolvió citas file_citation verificables para esta respuesta.'
      : 'Sin File Search el agente no consulta el índice documental, por lo que no hay fuentes que verificar.' }));
  }
  card.append(sources);
  return card;
}

export { h };
