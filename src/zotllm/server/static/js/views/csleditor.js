// CSL-Editor: Zitierstile suchen (zotero.org, in Zotero installiert, eigene), als eigenen Stil übernehmen, per Klick
// auf die Vorschau oder im Code bearbeiten, speichern und in Zotero installieren. Vorschau mit citeproc-js – dieselbe
// Software, mit der Zotero rendert.
import { h } from '../core/vdom.js';
import { state, update, ui, toast, run, confirmDialog, openModal, closeModal, saveSettings, loadSettings } from '../core/store.js';
import * as api from '../core/api.js';
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { btn, iconBtn, notice, spinner, field, textInput, select, segmented, numberInput, checkbox, badge,
  emptyState, paneProps, splitter, openMenu } from '../ui/components.js';
import { fmtAgo, fmtInt, debounce } from '../core/util.js';
import { viewHeader } from './shell.js';
import * as csl from '../core/csl.js';
import { SAMPLES } from '../core/csl-samples.js';

const EXTRA_KEY = 'zllm.csl.examples';
const FORMATS = () => ({ 'author-date': t('Autor-Jahr'), numeric: t('numerisch'), note: t('Fussnote'), author: t('Autor'), label: t('Kürzel') });

function st() {
  return ui('csl', {
    tab: 'own', own: null, zotero: null, zFilter: '', repoQuery: '', repoFormat: '', repo: null, repoBusy: false,
    open: null, doc: null, xml: '', dirty: false, history: [], future: [], selected: null,
    panel: 'props', code: '', codeError: '', lang: '', result: null, elements: [], changed: new Set(),
    engineReady: false, engineError: '', renderError: '', extra: null, pickQuery: '', pickResults: null,
  });
}

// -- Listen --------------------------------------------------------------------------------------------------------
async function loadOwn() {
  const s = st();
  try { s.own = (await api.get('/api/csl/styles')).styles; } catch { s.own = []; }
  update();
}

async function loadZotero() {
  const s = st();
  try { s.zotero = (await api.get('/api/csl/zotero')).styles; } catch { s.zotero = []; }
  update();
}

const searchRepo = debounce(async () => {
  const s = st();
  if (!s.repoQuery.trim() && !s.repoFormat) { s.repo = null; update(); return; }
  s.repoBusy = true; update();
  try {
    s.repo = await api.get(`/api/csl/repository?q=${encodeURIComponent(s.repoQuery)}&format=${encodeURIComponent(s.repoFormat)}`);
  } catch (err) { s.repo = { results: [], total: 0, error: err.message }; }
  s.repoBusy = false; update();
}, 350);

// -- Öffnen --------------------------------------------------------------------------------------------------------
async function confirmDiscard() {
  const s = st();
  return !s.dirty || confirmDialog(t('Änderungen verwerfen?'), t('Der geöffnete Stil hat ungespeicherte Änderungen.'), { ok: t('Verwerfen'), danger: true });
}

async function openStyle(source, loader) {
  if (!await confirmDiscard()) return;
  const s = st();
  s.open = { ...source, loading: true };
  s.selected = null; s.history = []; s.future = []; s.dirty = false; s.result = null; s.changed = new Set();
  update();
  try {
    const r = await loader();
    s.open = { ...source, ...r, loading: false };
    setDoc(r.xml, { fresh: true });
  } catch (err) {
    s.open = null;
    toast(err.message, 'error');
    update();
  }
}

const openOwn = slug => openStyle({ kind: 'own', slug }, () => api.get(`/api/csl/styles/${encodeURIComponent(slug)}`));
const openRepo = r => openStyle({ kind: 'repo', name: r.name, title: r.title },
  () => api.get(`/api/csl/repository/${encodeURIComponent(r.name)}`));
const openZotero = z => openStyle({ kind: 'zotero', id: z.id, title: z.title },
  () => api.get(`/api/csl/zotero/style?id=${encodeURIComponent(z.id)}`));

function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csl,.xml,application/xml';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const xml = await f.text();
    openStyle({ kind: 'file', title: f.name }, async () => {
      csl.parseStyle(xml);  // gültiges XML?
      return { xml, parent_xml: null, info: null };
    });
  };
  input.click();
}

// Übernehmen: Kopie mit eigenem Namen und eigener Kennung (bei abhängigen Stilen der Elternstil)
async function adopt() {
  const s = st();
  const o = s.open;
  const base = csl.styleInfo(s.doc).title || o.title || t('Stil');
  const title = (o.newTitle || '').trim() || t('{title} (angepasst)', { title: base });
  const r = await run(() => api.post('/api/csl/styles', { xml: o.kind === 'file' ? s.xml : o.xml, parent_xml: o.parent_xml, title }));
  if (!r) return;
  s.dirty = false;
  await loadOwn();
  s.tab = 'own';
  s.open = { kind: 'own', slug: r.slug, xml: r.xml, info: r.info, versions: r.versions };
  s.history = []; s.future = [];
  setDoc(r.xml, { fresh: true });
  toast(t('Als eigener Stil „{title}“ übernommen.', { title }), 'success');
}

// -- Stil im Speicher ------------------------------------------------------------------------------------------------
function setDoc(xml, { fresh = false, fromCode = false, keepSelection = true } = {}) {
  const s = st();
  const selIndex = keepSelection && s.selected ? s.elements.indexOf(s.selected) : -1;
  const selTag = s.selected ? s.selected.localName : '';
  try {
    s.doc = csl.parseStyle(xml);
  } catch (err) {
    if (fromCode) { s.codeError = err.message; update(); return false; }
    toast(err.message, 'error');
    return false;
  }
  s.xml = xml;
  s.codeError = '';
  if (!fromCode) s.code = xml;
  s.elements = csl.elements(s.doc);
  s.selected = selIndex >= 0 && s.elements[selIndex] && s.elements[selIndex].localName === selTag ? s.elements[selIndex] : null;
  if (fresh) { s.selected = null; s.lang = ''; }
  rerender(fresh);
  return true;
}

// Änderung am Dokument: Verlauf, neu rendern, geänderte Beispiele markieren
function commit(change) {
  const s = st();
  if (!editable()) return;
  s.history.push(s.xml);
  if (s.history.length > 100) s.history.shift();
  s.future = [];
  change(s.doc);
  s.xml = csl.serializeStyle(s.doc, s.xml);
  s.code = s.xml;
  s.dirty = true;
  s.elements = csl.elements(s.doc);
  rerender(false);
}

function setAttr(el, name, value) {
  commit(() => {
    if (value === '' || value === null || value === undefined || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? 'true' : String(value));
  });
}

function undo() {
  const s = st();
  if (!s.history.length) return;
  s.future.push(s.xml);
  s.dirty = true;
  setDoc(s.history.pop());
}

function redo() {
  const s = st();
  if (!s.future.length) return;
  s.history.push(s.xml);
  s.dirty = true;
  setDoc(s.future.pop());
}

const editable = () => { const o = st().open; return !!o && o.kind === 'own' && !o.loading; };

async function save() {
  const s = st();
  if (!editable()) return null;
  const r = await run(() => api.put(`/api/csl/styles/${encodeURIComponent(s.open.slug)}`, { xml: s.xml }));
  if (!r) return null;
  s.open = { ...s.open, xml: r.xml, info: r.info, versions: r.versions };
  s.dirty = false;
  setDoc(r.xml);
  loadOwn();
  toast(t('Stil gespeichert.'), 'success');
  return r;
}

async function install() {
  const s = st();
  if (s.dirty && !await save()) return;
  try {
    const r = await api.post(`/api/csl/styles/${encodeURIComponent(s.open.slug)}/install`, {});
    loadZotero();
    toast(t('In Zotero installiert – der Stil steht in Zotero, im Word-Plugin und in ZotLLM zur Wahl.'), 'success', 9000,
      { label: t('In ZotLLM verwenden'), onClick: async () => { await saveSettings({ citation_style: r.id }); await loadSettings(); toast(t('Zitierstil von ZotLLM geändert.'), 'success'); } });
  } catch (err) {
    if (err.status === 409) installByHand(err.message);
    else toast(err.message, 'error', 8000);
  }
}

function installByHand(reason) {
  openModal({
    title: t('In Zotero installieren'),
    body: () => h('div', { class: 'stack' },
      h('p', null, reason),
      h('p', null, t('So geht es von Hand:')),
      h('ol', { class: 'steps-list' },
        h('li', null, t('Stil als .csl-Datei speichern (Knopf unten).')),
        h('li', null, t('In Zotero: Einstellungen → Zitieren → unter der Liste der Stile auf „+“ klicken und die Datei wählen.')),
        h('li', null, t('Danach ist der Stil in Zotero, im Word-Plugin und in ZotLLM (Einstellungen → Zotero und Export) wählbar.'))),
      h('p', { class: 'muted small' }, t('Mit dem aktuellen ZotLLM-Plugin geht das künftig mit einem Klick: Einstellungen → Zotero und Export → Plugin speichern, dann in Zotero installieren.'))),
    actions: [{ label: t('Schliessen'), onClick: closeModal }, { label: t('Als .csl-Datei speichern'), kind: 'primary', icon: 'download', onClick: () => { closeModal(); download(); } }],
  });
}

function download() {
  const s = st();
  const name = (csl.styleInfo(s.doc).title || 'stil').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'stil';
  api.saveText(`${name}.csl`, s.xml, 'application/vnd.citationstyles.style+xml');
}

async function showVersions(e) {
  const s = st();
  const vs = (s.open && s.open.versions) || [];
  const r = e.currentTarget.getBoundingClientRect();
  if (!vs.length) { toast(t('Noch keine früheren Fassungen – sie entstehen beim Speichern.'), 'info'); return; }
  openMenu(r.left, r.bottom + 4, vs.slice(0, 15).map(v => ({
    label: t('Fassung vom {date}', { date: new Date(v.saved_at * 1000).toLocaleString() }),
    onClick: async () => {
      const x = await run(() => api.get(`/api/csl/styles/${encodeURIComponent(s.open.slug)}/versions/${encodeURIComponent(v.name)}`));
      if (!x) return;
      s.history.push(s.xml);
      s.dirty = true;
      setDoc(x.xml);
      toast(t('Frühere Fassung geladen – speichern, um sie zu übernehmen.'), 'info');
    },
  })));
}

// -- Vorschau --------------------------------------------------------------------------------------------------------
function previewLang() {
  const s = st();
  if (s.lang) return s.lang;
  const loc = s.doc ? csl.styleInfo(s.doc).locale : '';
  return loc || (state.settings && state.settings.language === 'en' ? 'en-US' : 'de-DE');
}

function examples() {
  const s = st();
  return [...SAMPLES(), ...(s.extra || []).map(x => ({ label: x.label, item: x.item, ref: x.ref }))];
}

async function rerender(fresh) {
  const s = st();
  if (!s.doc) return;
  if (!s.engineReady) {
    try {
      await csl.loadCiteproc();
      s.engineReady = true;
    } catch (err) {
      s.engineError = err.message; update(); return;
    }
  }
  await csl.preloadLocales([previewLang(), csl.styleInfo(s.doc).locale]);
  const items = {};
  for (const ex of examples()) items[ex.item.id] = ex.item;
  const before = fresh ? null : s.result;
  let res;
  try {
    res = csl.render(s.xml, items, previewLang());
    s.renderError = res.clean.error || '';
  } catch (err) {
    s.renderError = err.message || String(err);
    update();
    return;
  }
  s.renderElements = s.elements.slice();
  s.result = res;
  s.changed = new Set();
  if (before) {
    for (const id of Object.keys(items)) {
      if ((before.clean.cites[id] || '') !== (res.clean.cites[id] || '') || (before.clean.bib[id] || '') !== (res.clean.bib[id] || '')) s.changed.add(id);
    }
  }
  update();
}

function annotated(id, kind) {
  const s = st();
  const r = s.result;
  if (!r) return '';
  const clean = r.clean[kind][id] || '';
  const marked = r.marked ? r.marked[kind][id] : null;
  const frag = csl.annotate(clean, marked);
  const box = document.createElement('div');
  box.appendChild(frag);
  if (s.selected) {
    const sel = String(s.renderElements.indexOf(s.selected));
    box.querySelectorAll('.csl-node').forEach(n => { if (n.dataset.path.split(' ').includes(sel)) n.classList.add('csl-sel'); });
  }
  return box.innerHTML;
}

function onPreviewClick(e) {
  const s = st();
  const node = e.target.closest && e.target.closest('.csl-node');
  if (!node) return;
  const path = node.dataset.path.split(' ').map(Number);
  const el = s.renderElements[path[path.length - 1]];
  if (!el) return;
  s.selected = el;
  s.panel = 'props';
  update();
}

function exampleCard(ex) {
  const s = st();
  const id = ex.item.id;
  const changed = s.changed.has(id);
  return h('div', { key: id, class: ['csl-example', changed && 'changed'] },
    h('div', { class: 'csl-example-head' },
      h('span', { class: 'csl-example-label' }, ex.label),
      changed && badge(t('geändert'), 'info', t('Diese Ausgabe hat sich mit der letzten Änderung verändert.')),
      ex.ref && iconBtn('x', t('Beispiel entfernen'), () => removeExtra(ex.ref))),
    h('div', { class: 'csl-out-row' }, h('span', { class: 'csl-out-label' }, t('Im Text')),
      h('div', { class: 'csl-out', html: annotated(id, 'cites') || '–' })),
    s.result && Object.keys(s.result.clean.bib).length ? h('div', { class: 'csl-out-row' }, h('span', { class: 'csl-out-label' }, t('Verzeichnis')),
      h('div', { class: 'csl-out csl-bib', html: annotated(id, 'bib') || '–' })) : null);
}

function gallery() {
  const s = st();
  if (s.engineError) return notice('error', t('Die Vorschau konnte nicht geladen werden: {msg}', { msg: s.engineError }));
  if (!s.result) return h('div', { class: 'pad' }, spinner(18));
  const ex = examples();
  const nChanged = s.changed.size;
  const langs = [{ value: '', label: t('Sprache des Stils') }, { value: 'de-DE', label: 'Deutsch (DE)' }, { value: 'de-CH', label: 'Deutsch (CH)' },
    { value: 'de-AT', label: 'Deutsch (AT)' }, { value: 'en-US', label: 'English (US)' }, { value: 'en-GB', label: 'English (UK)' },
    { value: 'fr-FR', label: 'Français' }, { value: 'it-IT', label: 'Italiano' }];
  return h('div', { class: 'csl-gallery' },
    h('div', { class: 'csl-gallery-bar' },
      select({ value: s.lang, options: langs, label: t('Sprache der Vorschau'), onChange: v => { s.lang = v; rerender(true); } }),
      nChanged ? h('span', { class: 'csl-impact' }, icon('info', 14),
        t('Die letzte Änderung betrifft {n} von {m} Beispielen.', { n: nChanged, m: ex.length })) : h('span', { class: 'muted small' },
        editable() ? t('Auf einen Teil eines Belegs klicken, um ihn zu bearbeiten.') : t('Auf einen Teil klicken, um zu sehen, woher er stammt.'))),
    s.renderError ? notice('error', t('Fehler im Stil: {msg}', { msg: s.renderError })) : null,
    h('div', { class: 'csl-examples', onclick: onPreviewClick }, ex.map(exampleCard)),
    ownExamples());
}

// Eigene Einträge aus der Zotero-Bibliothek als zusätzliche Beispiele
function loadExtra() {
  const s = st();
  if (s.extra) return;
  s.extra = [];
  let refs = [];
  try { refs = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]'); } catch { refs = []; }
  if (refs.length) fetchExtra(refs);
}

async function fetchExtra(refs) {
  const s = st();
  try {
    const r = await api.post('/api/csl/items', { items: refs });
    s.extra = r.items.map(item => ({ ref: item.id, label: t('Eigener Eintrag'), item: { ...item, id: `x:${item.id}` } }));
  } catch { s.extra = []; }
  rerender(true);
}

function saveExtraRefs() {
  try { localStorage.setItem(EXTRA_KEY, JSON.stringify((st().extra || []).map(x => x.ref))); } catch { /* privat */ }
}

async function addExtra(hit) {
  const s = st();
  const ref = `${hit.lib}:${hit.key}`;
  if ((s.extra || []).some(x => x.ref === ref)) return;
  const r = await run(() => api.post('/api/csl/items', { items: [ref] }));
  if (!r || !r.items.length) return;
  s.extra = [...(s.extra || []), { ref, label: t('Eigener Eintrag'), item: { ...r.items[0], id: `x:${ref}` } }];
  s.pickResults = null; s.pickQuery = '';
  saveExtraRefs();
  rerender(true);
}

function removeExtra(ref) {
  const s = st();
  s.extra = (s.extra || []).filter(x => x.ref !== ref);
  saveExtraRefs();
  rerender(true);
}

const searchItems = debounce(async () => {
  const s = st();
  if (s.pickQuery.trim().length < 2) { s.pickResults = null; update(); return; }
  try {
    const r = await api.post('/api/library/search', { query: { q: s.pickQuery, limit: 8 } });
    s.pickResults = r.results || [];
  } catch { s.pickResults = []; }
  update();
}, 300);

function ownExamples() {
  const s = st();
  return h('div', { class: 'csl-own-examples' },
    h('div', { class: 'row' }, icon('zotero', 15), h('span', { class: 'small' }, t('Eigene Einträge aus Zotero als Beispiel:')),
      textInput({ value: s.pickQuery, placeholder: t('Titel, Autor:in, Jahr …'), label: t('Eintrag suchen'), class: 'csl-pick-input',
        onInput: v => { s.pickQuery = v; searchItems(); } })),
    s.pickResults ? h('div', { class: 'csl-pick-results' }, s.pickResults.length ? s.pickResults.map(r => h('button', {
      key: `${r.lib}:${r.key}`, type: 'button', class: 'csl-pick', onclick: () => addExtra(r),
    }, icon('plus', 13), h('span', null, `${r.creators ? r.creators + ' ' : ''}${r.year ? '(' + r.year + ') ' : ''}${r.title}`)))
      : h('span', { class: 'muted small' }, t('Keine Treffer.'))) : null);
}

// -- Eigenschaften -----------------------------------------------------------------------------------------------------
const VARIABLES = () => ({
  title: t('Titel'), 'container-title': t('Zeitschrift bzw. Buchtitel'), 'collection-title': t('Reihe'), publisher: t('Verlag'),
  'publisher-place': t('Verlagsort'), page: t('Seiten'), volume: t('Band'), issue: t('Heft'), edition: t('Auflage'), DOI: 'DOI',
  URL: 'URL', genre: t('Art (z. B. Masterarbeit)'), number: t('Nummer'), 'number-of-pages': t('Seitenzahl gesamt'),
  'citation-number': t('Belegnummer'), 'citation-label': t('Kürzel'), locator: t('Seitenangabe im Beleg'), note: t('Notiz'),
  author: t('Autor:innen'), editor: t('Herausgeber:innen'), translator: t('Übersetzer:innen'), issued: t('Erscheinungsdatum'),
  accessed: t('Abrufdatum'), 'year-suffix': t('Jahreszusatz (a, b …)'), event: t('Veranstaltung'), medium: t('Medium'),
  ISBN: 'ISBN', ISSN: 'ISSN', language: t('Sprache'), archive: t('Archiv'), source: t('Quelle (Datenbank)'),
  'original-date': t('Originaldatum'), 'container-author': t('Autor:innen des Sammelwerks'),
});
const INSERTABLE = ['title', 'container-title', 'collection-title', 'publisher', 'publisher-place', 'page', 'volume', 'issue', 'edition',
  'DOI', 'URL', 'genre', 'number', 'number-of-pages', 'ISBN', 'medium', 'note', 'editor', 'translator', 'accessed', 'issued'];
const NAME_VARS = new Set(['author', 'editor', 'translator', 'container-author', 'collection-editor', 'composer', 'director', 'interviewer', 'recipient']);
const DATE_VARS = new Set(['issued', 'accessed', 'original-date', 'event-date', 'submitted']);

function describe(el) {
  const v = el.getAttribute('variable');
  const vars = VARIABLES();
  const name = v ? v.split(' ').map(x => vars[x] || x).join(' / ') : '';
  switch (el.localName) {
    case 'text':
      if (el.getAttribute('macro')) return t('Baustein „{name}“', { name: el.getAttribute('macro') });
      if (el.getAttribute('term')) return t('Begriff „{name}“', { name: el.getAttribute('term') });
      if (el.hasAttribute('value')) return t('Fester Text');
      return t('Feld: {name}', { name });
    case 'names': return t('Namen: {name}', { name });
    case 'name': return t('Namensformat');
    case 'name-part': return t('Namensteil: {name}', { name: el.getAttribute('name') === 'family' ? t('Nachname') : t('Vorname') });
    case 'date': return t('Datum: {name}', { name });
    case 'date-part': return t('Datumsteil: {name}', { name: { year: t('Jahr'), month: t('Monat'), day: t('Tag') }[el.getAttribute('name')] || el.getAttribute('name') });
    case 'number': return t('Zahl: {name}', { name });
    case 'label': return t('Bezeichnung zu {name} (z. B. „S.“)', { name: name || t('Seitenangabe') });
    case 'group': return t('Gruppe');
    case 'layout': return t('Gesamter Beleg bzw. Eintrag');
    case 'citation': return t('Belege im Text');
    case 'bibliography': return t('Literaturverzeichnis');
    case 'macro': return t('Baustein „{name}“', { name: el.getAttribute('name') });
    default: return el.localName;
  }
}

const AFFIX = new Set(['text', 'names', 'name', 'name-part', 'date', 'date-part', 'number', 'label', 'group', 'layout']);
const FORMATTING = new Set(['text', 'names', 'name', 'name-part', 'date', 'date-part', 'number', 'label', 'group']);
const CASE = new Set(['text', 'date', 'date-part', 'number', 'label', 'name-part']);
const DELIM = new Set(['group', 'names', 'name', 'date', 'layout']);

function attrInput(el, name, label, opts = {}) {
  const ro = !editable();
  return field(label, textInput({ value: el.getAttribute(name) || '', placeholder: opts.placeholder || '', disabled: ro, label,
    onChange: v => setAttr(el, name, v) }), { help: opts.help, key: name });
}

function attrSelect(el, name, label, options, opts = {}) {
  return field(label, select({ value: el.getAttribute(name) || '', options, disabled: !editable(), label,
    onChange: v => setAttr(el, name, v) }), { help: opts.help, key: name });
}

function formatToggles(el) {
  const ro = !editable();
  const toggleBtn = (attr, on, ic, label) => {
    const active = el.getAttribute(attr) === on;
    return h('button', { type: 'button', class: ['fmt-btn', active && 'active'], disabled: ro, title: label, 'aria-pressed': active ? 'true' : 'false',
      onclick: () => setAttr(el, attr, active ? '' : on) }, ic);
  };
  return field(t('Schrift'), h('div', { class: 'fmt-row' },
    toggleBtn('font-style', 'italic', h('i', null, 'K'), t('kursiv')),
    toggleBtn('font-weight', 'bold', h('b', null, 'F'), t('fett')),
    toggleBtn('font-variant', 'small-caps', h('span', { style: { fontVariant: 'small-caps' } }, 'Kk'), t('Kapitälchen')),
    toggleBtn('text-decoration', 'underline', h('u', null, 'U'), t('unterstrichen')),
    toggleBtn('vertical-align', 'sup', h('span', null, 'x', h('sup', null, '2')), t('hochgestellt'))), { key: 'fmt' });
}

function nameOptions(name) {
  const ro = !editable();
  return [
    attrSelect(name, 'and', t('Vor dem letzten Namen'), [{ value: '', label: t('nur Trennzeichen') }, { value: 'text', label: t('Wort „und“') }, { value: 'symbol', label: '„&“' }]),
    attrSelect(name, 'delimiter-precedes-last', t('Trennzeichen auch vor „und“'), [{ value: '', label: t('Standard (ab drei Namen)') },
      { value: 'always', label: t('immer') }, { value: 'never', label: t('nie') }, { value: 'after-inverted-name', label: t('nach „Nachname, Vorname“') }]),
    attrSelect(name, 'name-as-sort-order', t('Reihenfolge'), [{ value: '', label: t('Vorname Nachname') },
      { value: 'first', label: t('erster Name: Nachname, Vorname') }, { value: 'all', label: t('alle: Nachname, Vorname') }]),
    attrInput(name, 'initialize-with', t('Vornamen abkürzen mit'), { placeholder: t('leer = ausschreiben, z. B. „. “'), help: t('Zeichen nach jeder Initiale, z. B. „. “ ergibt „A. B. Muster“. Leer: Vornamen ausschreiben.') }),
    attrSelect(name, 'form', t('Form'), [{ value: '', label: t('ganzer Name') }, { value: 'short', label: t('nur Nachname') }, { value: 'count', label: t('Anzahl') }]),
    h('div', { class: 'field-row', key: 'etal' },
      field(t('„et al.“ ab'), numberInput({ value: name.getAttribute('et-al-min') ? Number(name.getAttribute('et-al-min')) : null, min: 1, max: 50, int: true, nullable: true,
        disabled: ro, placeholder: '–', label: t('„et al.“ ab'), onChange: v => setAttr(name, 'et-al-min', v) }), { help: t('Ab wie vielen Namen „et al.“ steht. Leer: Einstellung des Stils (Allgemein).') }),
      field(t('Namen davor'), numberInput({ value: name.getAttribute('et-al-use-first') ? Number(name.getAttribute('et-al-use-first')) : null, min: 1, max: 50, int: true, nullable: true,
        disabled: ro, placeholder: '–', label: t('Namen davor'), onChange: v => setAttr(name, 'et-al-use-first', v) }), { help: t('Wie viele Namen vor „et al.“ stehen.') })),
  ];
}

function variableSelect(el) {
  const vars = VARIABLES();
  const cur = el.getAttribute('variable') || '';
  const opts = Object.entries(vars).filter(([k]) => !NAME_VARS.has(k) && !DATE_VARS.has(k)).map(([value, label]) => ({ value, label }));
  if (cur && !vars[cur]) opts.unshift({ value: cur, label: cur });
  return attrSelect(el, 'variable', t('Feld'), opts);
}

function propsFor(el) {
  const tag = el.localName;
  const out = [];
  if (tag === 'text') {
    if (el.hasAttribute('value')) out.push(attrInput(el, 'value', t('Text')));
    else if (el.getAttribute('variable')) {
      out.push(variableSelect(el));
      out.push(attrSelect(el, 'form', t('Form'), [{ value: '', label: t('lang') }, { value: 'short', label: t('kurz (falls vorhanden)') }]));
    } else if (el.getAttribute('term')) {
      out.push(attrSelect(el, 'form', t('Form'), [{ value: '', label: t('lang') }, { value: 'short', label: t('kurz') }, { value: 'symbol', label: t('Symbol') }]));
    }
  }
  if (AFFIX.has(tag)) {
    out.push(h('div', { class: 'field-row', key: 'affix' },
      attrInput(el, 'prefix', t('Text davor'), { help: t('Erscheint nur, wenn dieser Teil etwas ausgibt – z. B. „(“ oder „, “.') }),
      attrInput(el, 'suffix', t('Text danach'))));
  }
  if (DELIM.has(tag)) out.push(attrInput(el, 'delimiter', t('Trennzeichen'), { help: t('Steht zwischen den einzelnen Teilen bzw. Namen, z. B. „, “ oder „; “.') }));
  if (FORMATTING.has(tag)) out.push(formatToggles(el));
  if (CASE.has(tag)) {
    out.push(attrSelect(el, 'text-case', t('Gross-/Kleinschreibung'), [{ value: '', label: t('wie im Eintrag') }, { value: 'lowercase', label: t('klein') },
      { value: 'uppercase', label: t('GROSS') }, { value: 'capitalize-first', label: t('Erster Buchstabe gross') }, { value: 'title', label: t('Titel-Schreibweise (englisch)') },
      { value: 'sentence', label: t('Satz-Schreibweise') }]));
  }
  if (tag === 'text' && !el.hasAttribute('value')) out.push(field(null, checkbox({ checked: el.getAttribute('quotes') === 'true', disabled: !editable(),
    label: t('In Anführungszeichen'), onChange: v => setAttr(el, 'quotes', v) }), { key: 'quotes' }));
  if (['text', 'label', 'date-part'].includes(tag)) out.push(field(null, checkbox({ checked: el.getAttribute('strip-periods') === 'true', disabled: !editable(),
    label: t('Punkte entfernen'), onChange: v => setAttr(el, 'strip-periods', v) }), { key: 'strip' }));
  if (tag === 'names') {
    let name = [...el.children].find(c => c.localName === 'name');
    if (name) out.push(h('div', { class: 'csl-subhead', key: 'nameshead' }, t('Namen')), ...nameOptions(name));
    else if (editable()) out.push(btn(t('Namensformat hinzufügen'), { size: 'sm', icon: 'plus', onClick: () => commit(doc => el.insertBefore(csl.createElement(doc, 'name'), el.firstChild)) }));
  }
  if (tag === 'name') out.push(...nameOptions(el));
  if (tag === 'date') {
    out.push(attrSelect(el, 'form', t('Darstellung'), [{ value: '', label: t('eigene Datumsteile') }, { value: 'numeric', label: t('Zahlen der Sprache (z. B. 12.03.2024)') },
      { value: 'text', label: t('Text der Sprache (z. B. 12. März 2024)') }]));
    if (el.getAttribute('form')) out.push(attrSelect(el, 'date-parts', t('Teile'), [{ value: '', label: t('Tag, Monat und Jahr') }, { value: 'year-month', label: t('Monat und Jahr') }, { value: 'year', label: t('nur Jahr') }]));
  }
  if (tag === 'date-part') {
    const part = el.getAttribute('name');
    const forms = { year: [['', t('vierstellig')], ['short', t('zweistellig')]],
      month: [['', t('ausgeschrieben')], ['short', t('abgekürzt')], ['numeric', t('Zahl')], ['numeric-leading-zeros', t('Zahl mit Null (03)')]],
      day: [['', t('Zahl')], ['numeric-leading-zeros', t('Zahl mit Null (05)')], ['ordinal', t('Ordnungszahl')]] }[part] || [];
    if (forms.length) out.push(attrSelect(el, 'form', t('Form'), forms.map(([value, label]) => ({ value, label }))));
  }
  if (tag === 'label') {
    out.push(attrSelect(el, 'form', t('Form'), [{ value: '', label: t('ausgeschrieben (Seite)') }, { value: 'short', label: t('abgekürzt (S.)') }, { value: 'symbol', label: t('Symbol') }]));
    out.push(attrSelect(el, 'plural', t('Mehrzahl'), [{ value: '', label: t('je nach Angabe') }, { value: 'always', label: t('immer') }, { value: 'never', label: t('nie') }]));
  }
  if (tag === 'number') out.push(attrSelect(el, 'form', t('Form'), [{ value: '', label: t('Zahl') }, { value: 'ordinal', label: t('Ordnungszahl (2.)') },
    { value: 'long-ordinal', label: t('ausgeschrieben (zweite)') }, { value: 'roman', label: t('römisch') }]));
  return out;
}

const insertState = { variable: '' };
function structureActions(el) {
  if (!editable() || ['citation', 'bibliography', 'layout', 'macro', 'style', 'info'].includes(el.localName)) return null;
  const s = st();
  const vars = VARIABLES();
  const addField = () => {
    const v = insertState.variable;
    if (!v) return;
    commit(doc => {
      const node = NAME_VARS.has(v) ? csl.createElement(doc, 'names', { variable: v, prefix: ', ' })
        : DATE_VARS.has(v) ? csl.createElement(doc, 'date', { variable: v, form: 'numeric', prefix: ', ' })
          : csl.createElement(doc, 'text', { variable: v, prefix: ', ' });
      if (node.localName === 'names') node.appendChild(csl.createElement(doc, 'name'));
      csl.insertAfter(el, node);
      s.selected = node;
    });
  };
  return h('div', { class: 'csl-structure' },
    h('div', { class: 'row' },
      btn(t('Früher'), { size: 'sm', icon: 'arrowLeft', disabled: !csl.siblingElement(el, -1), title: t('Mit dem vorherigen Teil tauschen'),
        onClick: () => commit(() => csl.moveElement(el, -1)) }),
      btn(t('Später'), { size: 'sm', icon: 'arrowRight', disabled: !csl.siblingElement(el, 1), title: t('Mit dem nächsten Teil tauschen'),
        onClick: () => commit(() => csl.moveElement(el, 1)) }),
      btn(t('Entfernen'), { size: 'sm', icon: 'trash', kind: 'ghost', onClick: () => { commit(() => csl.removeElement(el)); s.selected = null; update(); } })),
    h('div', { class: 'row' },
      select({ value: insertState.variable, label: t('Feld einfügen'), options: [{ value: '', label: t('Feld danach einfügen …') },
        ...INSERTABLE.map(v => ({ value: v, label: vars[v] || v }))], onChange: v => { insertState.variable = v; update(); } }),
      btn(t('Einfügen'), { size: 'sm', icon: 'plus', disabled: !insertState.variable, onClick: addField })));
}

function selectedPanel(el) {
  const s = st();
  const { macro, chain } = csl.context(el);
  const crumbs = chain.filter(c => ['citation', 'bibliography', 'macro', 'group', 'names', 'date', 'layout'].includes(c.localName) || c === el);
  const uses = macro ? csl.macroUses(s.doc, macro) : 0;
  return h('div', { class: 'stack' },
    h('div', { class: 'csl-crumbs' }, crumbs.map((c, i) => h('button', { key: i, type: 'button', class: ['csl-crumb', c === el && 'active'],
      onclick: () => { s.selected = c; update(); } }, describe(c)))),
    h('h3', { class: 'csl-sel-title' }, describe(el)),
    macro ? notice('info', uses > 1
      ? t('Teil des Bausteins „{name}“, der an {n} Stellen verwendet wird. Änderungen wirken überall dort – die betroffenen Beispiele werden markiert.', { name: macro, n: uses })
      : t('Teil des Bausteins „{name}“.', { name: macro })) : null,
    !editable() ? notice('info', t('Zum Bearbeiten zuerst als eigenen Stil übernehmen.')) : null,
    h('div', { class: 'csl-props' }, propsFor(el)),
    structureActions(el),
    btn(t('Auswahl aufheben'), { size: 'sm', kind: 'ghost', onClick: () => { s.selected = null; update(); } }));
}

// Ohne Auswahl: Einstellungen, die für den ganzen Stil bzw. alle Belege gelten
function generalPanel() {
  const s = st();
  const doc = s.doc;
  const root = doc.documentElement;
  const cit = doc.getElementsByTagNameNS(csl.NS, 'citation')[0];
  const bib = doc.getElementsByTagNameNS(csl.NS, 'bibliography')[0];
  const ro = !editable();
  const num = (el, attr, label, help) => field(label, numberInput({ value: el.getAttribute(attr) ? Number(el.getAttribute(attr)) : null, min: 1, max: 50, int: true,
    nullable: true, disabled: ro, placeholder: '–', label, onChange: v => setAttr(el, attr, v) }), { help, key: attr });
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, editable() ? t('Auf einen Teil eines Belegs in der Vorschau klicken, um genau diesen Teil zu bearbeiten. Hier stehen die Einstellungen für den ganzen Stil.')
      : t('Vorschau eines fremden Stils. Zum Bearbeiten oben „Als eigenen Stil übernehmen“ wählen.')),
    cit ? h('div', { class: 'csl-props' }, h('div', { class: 'csl-subhead' }, t('Belege im Text')),
      h('div', { class: 'field-row' }, num(cit, 'et-al-min', t('„et al.“ ab'), t('Ab wie vielen Namen „et al.“ steht.')), num(cit, 'et-al-use-first', t('Namen davor')))) : null,
    bib ? h('div', { class: 'csl-props' }, h('div', { class: 'csl-subhead' }, t('Literaturverzeichnis')),
      h('div', { class: 'field-row' }, num(bib, 'et-al-min', t('„et al.“ ab')), num(bib, 'et-al-use-first', t('Namen davor'))),
      field(null, checkbox({ checked: bib.getAttribute('hanging-indent') === 'true', disabled: ro, label: t('Hängender Einzug'),
        onChange: v => setAttr(bib, 'hanging-indent', v) }), { key: 'hang' }),
      attrInput(bib, 'subsequent-author-substitute', t('Wiederholte Autor:innen ersetzen durch'), { placeholder: t('leer = immer ausschreiben, z. B. „———“') })) : null,
    h('div', { class: 'csl-props' }, h('div', { class: 'csl-subhead' }, t('Ganzer Stil')),
      attrSelect(root, 'page-range-format', t('Seitenbereiche'), [{ value: '', label: t('wie im Eintrag (115–132)') }, { value: 'expanded', label: t('ausgeschrieben (115–132)') },
        { value: 'minimal', label: t('kurz (115–32)') }, { value: 'minimal-two', label: t('kurz, zweistellig (115–32)') }, { value: 'chicago', label: 'Chicago' }])));
}

const applyCode = debounce(() => {
  const s = st();
  if (s.code === s.xml) { if (s.codeError) { s.codeError = ''; update(); } return; }
  const before = s.xml;
  if (setDoc(s.code, { fromCode: true, keepSelection: false })) {
    s.history.push(before);
    s.future = [];
    s.dirty = true;
  }
}, 500);

function codePanel() {
  const s = st();
  const jump = el => {
    const area = document.querySelector('.csl-code');
    const range = el && csl.sourceRange(s.doc, el, s.xml);
    if (!area || !range) return;
    area.focus();
    area.setSelectionRange(range.start, range.end);
    const lines = s.xml.slice(0, range.start).split('\n').length;
    area.scrollTop = Math.max(0, (lines - 4) * 18);
  };
  return h('div', { class: 'csl-code-wrap' },
    s.codeError ? notice('error', t('XML-Fehler: {msg}', { msg: s.codeError })) : null,
    h('textarea', { class: 'input csl-code', spellcheck: false, value: s.code, readonly: !editable(), 'aria-label': t('Code des Stils'),
      oninput: e => { s.code = e.target.value; applyCode(); } }),
    h('div', { class: 'row' },
      s.selected ? btn(t('Zur Auswahl springen'), { size: 'sm', icon: 'target', onClick: () => jump(s.selected) }) : null,
      h('span', { class: 'muted small' }, t('Änderungen erscheinen sofort in der Vorschau.'))));
}

function sidePanel() {
  const s = st();
  return h('aside', { class: 'csl-side', ...paneProps('csl-props', 340) },
    splitter('csl-props', { def: 340, min: 260, max: 620, side: 'right' }),
    segmented({ value: s.panel, options: [{ value: 'props', label: t('Eigenschaften'), icon: 'sliders' }, { value: 'code', label: t('Code'), icon: 'file' }],
      onChange: v => { s.panel = v; if (v === 'code') s.code = s.xml; update(); } }),
    h('div', { class: 'csl-side-body scroll' }, s.panel === 'code' ? codePanel() : s.selected ? selectedPanel(s.selected) : generalPanel()));
}

// -- Liste links -----------------------------------------------------------------------------------------------------
function styleList() {
  const s = st();
  if (s.tab === 'own' && s.own === null) loadOwn();
  if (s.tab === 'zotero' && s.zotero === null) loadZotero();
  const item = (key, active, title, sub, onClick, extra) => h('div', { key, class: ['side-item', active && 'active'], role: 'button', tabindex: 0, onclick: onClick,
    onkeydown: e => { if (e.key === 'Enter') onClick(); } },
  h('div', { class: 'side-item-text', title }, h('div', { class: 'side-item-title wrap2' }, title), sub && h('div', { class: 'side-item-sub' }, sub)), extra);
  const fmt = FORMATS();
  let body;
  if (s.tab === 'own') {
    body = s.own === null ? spinner(16) : s.own.length ? s.own.map(x => item(x.slug, s.open && s.open.kind === 'own' && s.open.slug === x.slug, x.title,
      t('geändert {ago}', { ago: fmtAgo(x.modified) }), () => openOwn(x.slug),
      iconBtn('trash', t('Löschen'), async e => {
        e.stopPropagation();
        if (!await confirmDialog(t('Stil löschen?'), t('„{title}“ wird aus ZotLLM gelöscht. In Zotero installierte Fassungen bleiben dort erhalten.', { title: x.title }), { ok: t('Löschen'), danger: true })) return;
        await run(() => api.del(`/api/csl/styles/${encodeURIComponent(x.slug)}`));
        if (s.open && s.open.slug === x.slug) { s.open = null; s.doc = null; s.dirty = false; }
        loadOwn();
      })))
      : h('p', { class: 'muted small pad' }, t('Noch keine eigenen Stile. Suche einen Stil auf zotero.org oder in Zotero und übernimm ihn als Vorlage.'));
  } else if (s.tab === 'zotero') {
    const f = s.zFilter.trim().toLowerCase();
    const list = (s.zotero || []).filter(z => !f || z.title.toLowerCase().includes(f));
    body = [textInput({ value: s.zFilter, placeholder: t('Filtern …'), label: t('Installierte Stile filtern'), onInput: v => { s.zFilter = v; update(); } }),
      s.zotero === null ? spinner(16) : list.length ? list.slice(0, 300).map(z => item(z.id, s.open && s.open.kind === 'zotero' && s.open.id === z.id, z.title,
        [fmt[z.format] || z.format, z.dependent && t('abhängig')].filter(Boolean).join(' · '), () => openZotero(z)))
        : h('p', { class: 'muted small pad' }, s.zotero.length ? t('Keine Treffer.') : t('Keine Stile gefunden – ist der Zotero-Datenordner bekannt (Einstellungen → Zotero und Export)?'))];
  } else {
    const r = s.repo;
    body = [h('div', { class: 'stack-sm' },
      textInput({ value: s.repoQuery, placeholder: t('Name, Zeitschrift, Hochschule …'), label: t('Stile auf zotero.org suchen'),
        onInput: v => { s.repoQuery = v; searchRepo(); } }),
      select({ value: s.repoFormat, label: t('Format'), options: [{ value: '', label: t('alle Formate') }, ...Object.entries(fmt).map(([value, label]) => ({ value, label }))],
        onChange: v => { s.repoFormat = v; searchRepo(); } })),
    s.repoBusy ? spinner(16) : null,
    r && r.error ? notice('error', r.error) : null,
    r && !r.error ? h('p', { class: 'muted small' }, r.offline ? t('Offline – gespeicherte Liste.') : '',
      ' ', r.total > r.results.length ? t('{n} von {total} Treffern', { n: fmtInt(r.results.length), total: fmtInt(r.total) }) : t('{n} Treffer', { n: fmtInt(r.total) })) : null,
    r && r.results ? r.results.map(x => item(x.name, s.open && s.open.kind === 'repo' && s.open.name === x.name, x.title,
      [fmt[x.format] || x.format, x.dependent && t('abhängig')].filter(Boolean).join(' · '), () => openRepo(x))) : null,
    !r ? h('p', { class: 'muted small pad' }, t('Die Liste der rund 10 000 Stile wird erst bei der Suche geladen (einmalig rund 300 KB, danach nur bei Änderungen).')) : null];
  }
  return h('aside', { class: 'side-list csl-list', ...paneProps('csl-list', 280) },
    segmented({ value: s.tab, size: 'sm', options: [{ value: 'own', label: t('Eigene') }, { value: 'zotero', label: 'Zotero' }, { value: 'repo', label: 'zotero.org' }],
      onChange: v => { s.tab = v; update(); } }),
    h('div', { class: 'side-items' }, body),
    btn(t('.csl-Datei importieren'), { icon: 'upload', size: 'sm', kind: 'ghost', onClick: importFile }),
    splitter('csl-list', { def: 280, max: 520 }));
}

// -- Kopf mit Aktionen -----------------------------------------------------------------------------------------------
function toolbar() {
  const s = st();
  const o = s.open;
  const info = csl.styleInfo(s.doc);
  const fmt = FORMATS();
  if (o.kind !== 'own') {
    const suggested = t('{title} (angepasst)', { title: info.title || o.title || '' });
    return h('div', { class: 'csl-toolbar foreign' },
      h('div', { class: 'csl-title' }, h('h2', null, info.title || o.title), h('div', { class: 'row' },
        badge(fmt[info.format] || info.format || '–'), o.info && o.info.dependent ? badge(t('abhängiger Stil'), 'warning',
          t('Ein abhängiger Stil verweist auf einen Elternstil. Beim Übernehmen entsteht eine eigenständige Kopie des Elternstils.')) : null,
        badge(o.kind === 'repo' ? 'zotero.org' : o.kind === 'zotero' ? t('in Zotero installiert') : t('Datei')))),
      h('div', { class: 'csl-adopt' },
        textInput({ value: o.newTitle ?? suggested, label: t('Name des eigenen Stils'), onInput: v => { o.newTitle = v; } }),
        btn(t('Als eigenen Stil übernehmen'), { kind: 'primary', icon: 'plus', onClick: adopt })));
  }
  return h('div', { class: 'csl-toolbar' },
    h('div', { class: 'csl-title' },
      textInput({ value: info.title, label: t('Name des Stils'), class: 'csl-title-input', onChange: v => commit(doc => {
        const el = doc.getElementsByTagNameNS(csl.NS, 'info')[0].getElementsByTagNameNS(csl.NS, 'title')[0];
        if (el && v.trim()) el.textContent = v.trim();
      }) }),
      h('div', { class: 'row' }, badge(fmt[info.format] || info.format || '–'), s.dirty ? badge(t('ungespeichert'), 'warning') : badge(t('gespeichert'), 'success'))),
    h('div', { class: 'row csl-actions' },
      iconBtn('undo', t('Rückgängig (Strg+Z)'), undo, { disabled: !s.history.length }),
      iconBtn('redo', t('Wiederholen'), redo, { disabled: !s.future.length }),
      iconBtn('history', t('Frühere Fassungen'), showVersions),
      btn(t('Speichern'), { icon: 'save', kind: s.dirty ? 'primary' : 'secondary', onClick: save }),
      btn(t('In Zotero installieren'), { icon: 'zotero', onClick: install, title: t('Der Stil steht danach in Zotero, im Word-Plugin und in ZotLLM zur Wahl.') }),
      iconBtn('download', t('Als .csl-Datei speichern'), download)));
}

function editorMain() {
  const s = st();
  if (!s.open) {
    return emptyState('cslStyle', t('Zitierstil anpassen'), t('Wähle links einen eigenen Stil, einen in Zotero installierten oder suche auf zotero.org. Fremde Stile lassen sich als Vorlage übernehmen; das Original bleibt unverändert.'),
      [btn(t('Auf zotero.org suchen'), { kind: 'primary', icon: 'search', onClick: () => { s.tab = 'repo'; update(); } }), btn(t('.csl-Datei importieren'), { icon: 'upload', onClick: importFile })]);
  }
  if (s.open.loading || !s.doc) return h('div', { class: 'pad' }, spinner(18));
  return h('div', { class: 'csl-main' }, toolbar(), gallery());
}

export function cslEditorView() {
  const s = st();
  loadExtra();
  const keys = e => {
    if (!(e.ctrlKey || e.metaKey) || !editable()) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') { e.preventDefault(); undo(); }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  return h('div', { class: 'view-wrap', onkeydown: keys },
    viewHeader(t('CSL-Editor'), t('Zitierstile suchen, anpassen und in Zotero installieren – gilt für alle Projekte')),
    h('div', { class: 'csl-layout' }, styleList(),
      h('div', { class: 'col-main scroll' }, h('div', { class: 'col-inner' }, editorMain())),
      s.open && s.doc && !s.open.loading ? sidePanel() : null));
}

// Beim Verlassen nicht fragen (der Stil bleibt im Speicher, bis ein anderer geöffnet wird); vor dem Schliessen warnen
window.addEventListener('beforeunload', e => {
  const s = state.ui && state.ui.csl;
  if (s && s.dirty) { e.preventDefault(); e.returnValue = ''; }
});
