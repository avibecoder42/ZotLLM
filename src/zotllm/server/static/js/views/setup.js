// Einrichtung: Startfenster jedes Programmstarts (oberster Eintrag der Navigationsleiste, unter dem Programmsymbol).
// Oben der Einstieg in die Projekte (Alle Projekte, Neues Projekt, Projekt importieren), darunter die Checkliste.
import { h } from '../core/vdom.js';
import { state, openModal, closeModal, loadSetup, loadStatus, ui, project, openProjects, archivedProjects } from '../core/store.js';
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { btn, iconBtn, notice, spinner } from '../ui/components.js';
import { navigate } from './shell.js';
import { plural } from '../core/util.js';
import { authorizeZotero, savePlugin } from './settings.js';
import { newProjectDialog, importProject } from './projects.js';

const STEP_ICONS = { zotero: 'zotero', llm: 'ai', embedding: 'index', corpus: 'corpus', index: 'refresh', write: 'edit', plugin: 'plug' };

export function zoteroHelp() {
  openModal({
    title: t('Zotero mit ZotLLM verbinden'),
    body: () => h('div', { class: 'stack' },
      h('p', null, t('ZotLLM liest deine Bibliothek über die lokale Schnittstelle von Zotero. Sie ist anfangs ausgeschaltet:')),
      h('ol', { class: 'steps-list' },
        h('li', null, t('Zotero öffnen.')),
        h('li', null, h('b', null, t('Bearbeiten → Einstellungen')), ' ', t('(macOS: Zotero → Einstellungen) wählen.')),
        h('li', null, t('Bereich „Erweitert“ öffnen.')),
        h('li', null, t('Häkchen bei „Anderen Anwendungen auf diesem Computer erlauben, mit Zotero zu kommunizieren“ setzen.'))),
      notice('info', t('Zotero muss geöffnet sein, solange ZotLLM abgleicht oder indexiert. Fragen funktionieren auch ohne Zotero.'))),
    actions: [{ label: t('Erneut prüfen'), kind: 'primary', icon: 'refresh', onClick: async () => { closeModal(); await loadStatus(); await loadSetup(); } }],
  });
}

function stepAction(step) {
  switch (step.id) {
    case 'zotero': return btn(t('Anleitung'), { size: 'sm', icon: 'help', onClick: zoteroHelp });
    case 'llm': return btn(t('Anbieter wählen'), { size: 'sm', kind: step.done ? 'ghost' : 'primary', onClick: () => { ui('settings').tab = 'models'; navigate('settings'); } });
    case 'embedding': return btn(t('Embedding-Modell'), { size: 'sm', kind: step.done ? 'ghost' : 'primary', onClick: () => { ui('settings').tab = 'embedding'; navigate('settings'); } });
    case 'corpus': return btn(step.done ? t('Korpora') : t('Korpus anlegen'), { size: 'sm', kind: step.done ? 'ghost' : 'primary', icon: 'plus', onClick: () => navigate('corpora') });
    case 'index': return btn(t('Indexierung'), { size: 'sm', kind: step.done ? 'ghost' : 'primary', onClick: () => navigate('index') });
    case 'write': return step.done ? null : btn(t('Freigeben'), { size: 'sm', onClick: authorizeZotero });
    case 'plugin': return step.done ? null : btn(t('Plugin speichern'), { size: 'sm', icon: 'download', onClick: savePlugin });
    default: return null;
  }
}

function setupCard() {
  const s = state.setup;
  if (!s) return h('div', { class: 'card' }, spinner(16));
  const required = s.steps.filter(x => !x.optional);
  const done = required.filter(x => x.done).length;
  let firstOpen = true;
  return h('section', { class: 'card setup-card' },
    h('div', { class: 'card-head' },
      h('h3', null, icon('check', 16), s.ready ? t('Alles eingerichtet') : t('Einrichtung')),
      h('span', { class: 'muted small' }, t('{a} von {b} erledigt', { a: done, b: required.length })),
      h('div', { class: 'card-actions' }, iconBtn('refresh', t('Neu prüfen'), () => { loadStatus(); loadSetup(); }))),
    h('div', { class: 'setup-progress' }, h('div', { style: { width: `${Math.round(100 * done / required.length)}%` } })),
    h('ol', { class: 'setup-steps' }, s.steps.map(step => {
      const current = !step.done && !step.optional && firstOpen;
      if (current) firstOpen = false;
      return h('li', { key: step.id, class: ['setup-step', step.done && 'done', current && 'current', step.optional && 'optional'] },
        h('div', { class: 'setup-mark' }, step.done ? icon('check', 15) : icon(STEP_ICONS[step.id], 15)),
        h('div', { class: 'setup-text' },
          h('div', { class: 'setup-title' }, step.title, step.optional && h('span', { class: 'badge badge-neutral' }, t('optional'))),
          h('div', { class: 'setup-detail' }, step.detail)),
        h('div', { class: 'setup-action' }, stepAction(step)));
    })));
}

function entryCard(ic, title, lines, onClick, primary = false) {
  return h('button', { type: 'button', class: ['start-card', primary && 'primary'], onclick: onClick },
    h('div', { class: 'start-card-icon' }, icon(ic, 22)),
    h('div', { class: 'start-card-title' }, title),
    lines.filter(Boolean).map((x, i) => h('div', { key: i, class: 'start-card-text' }, x)));
}

export function setupView() {
  const p = project();
  const open = openProjects().length;
  const archived = archivedProjects().length;
  const ready = state.setup && state.setup.ready;
  return h('div', { class: 'start-main setup-page' }, h('div', { class: 'start-inner setup-inner' },
    h('div', { class: 'start-brand' }, h('img', { src: '/static/img/icon.svg', width: 40, height: 40, alt: '' }),
      h('div', null, h('div', { class: 'brand-name' }, 'ZotLLM'), h('p', null, t('Fragen an die eigene Zotero-Bibliothek – mit Belegen bis auf die Seite.')))),
    h('div', { class: 'setup-entry' },
      entryCard('home', t('Alle Projekte'), [
        plural(open, t('Projekt'), t('Projekte')) + (archived ? ` · ${t('{n} im Archiv', { n: archived })}` : ''),
        p && t('Aktiv: {name}', { name: p.name })], () => navigate('start'), ready),
      entryCard('plus', t('Neues Projekt'), [t('Korpora, Fragen und Forschungsstände für ein neues Vorhaben bündeln.')], newProjectDialog),
      entryCard('download', t('Projekt importieren'), [t('Ein Projekt aus einer .zllm-Datei laden (Sicherung, anderer Rechner).')], importProject)),
    setupCard()));
}
