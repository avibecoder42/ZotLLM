// Beispiele für die Vorschau im CSL-Editor: je ein typischer Dokumenttyp, erfundene Angaben (CSL-JSON).
// __locator: Seitenangabe im Beleg, damit auch „S. 12“ sichtbar wird.
import { t } from './i18n.js';

const person = (family, given) => ({ family, given });

export const SAMPLES = () => [
  { label: t('Buch'), item: {
    id: 'book', type: 'book', title: 'Soziale Arbeit im digitalen Wandel', author: [person('Muster', 'Anna'), person('Beispiel', 'Ben')],
    edition: '2', publisher: 'Beispielverlag', 'publisher-place': 'Zürich', issued: { 'date-parts': [[2019]] }, __locator: '45',
  } },
  { label: t('Sammelbandbeitrag'), item: {
    id: 'chapter', type: 'chapter', title: 'Beratung online: Chancen und Grenzen', author: [person('Keller', 'Lea')],
    editor: [person('Huber', 'Tom')], 'container-title': 'Handbuch Beratung', publisher: 'Beispielverlag', 'publisher-place': 'Bern',
    page: '115-132', issued: { 'date-parts': [[2021]] }, __locator: '120',
  } },
  { label: t('Zeitschriftenartikel'), item: {
    id: 'article', type: 'article-journal', title: 'Writing with machines: How students use generative AI in academic essays',
    author: [person('Lindqvist', 'Maja'), person('Okafor', 'Chinedu')], 'container-title': 'Teaching & Technology Review',
    volume: '12', issue: '3', page: '41-58', DOI: '10.5555/ttr.2025.041', issued: { 'date-parts': [[2025, 3]] }, __locator: '43',
  } },
  { label: t('Artikel, vier Autor:innen'), item: {
    id: 'article4', type: 'article-journal', title: 'Generative AI as a writing tutor: A randomised field experiment',
    author: [person('Tanaka', 'Hiro'), person('Novak', 'Petra'), person('Castillo', 'Rafael'), person('Weber', 'Jonas')],
    'container-title': 'Higher Education Futures', volume: '8', page: '7-29', issued: { 'date-parts': [[2024]] }, __locator: '9',
  } },
  { label: t('Zeitungsartikel'), item: {
    id: 'newspaper', type: 'article-newspaper', title: 'KI im Klassenzimmer', author: [person('Brunner', 'Lea')],
    'container-title': 'Neue Beispiel-Zeitung', page: 'A20', issued: { 'date-parts': [[2024, 3, 12]] }, __locator: 'A20',
  } },
  { label: t('Webseite'), item: {
    id: 'webpage', type: 'webpage', title: 'Leitfaden: Generative KI in der Lehre', author: [{ literal: 'Beispiel-Hochschule' }],
    URL: 'https://www.example.org/leitfaden-ki', issued: { 'date-parts': [[2025, 2, 1]] }, accessed: { 'date-parts': [[2026, 10, 1]] },
  } },
  { label: t('Hochschulschrift'), item: {
    id: 'thesis', type: 'thesis', genre: 'Masterarbeit', title: 'Feedback durch Sprachmodelle in der Schreibberatung',
    author: [person('Weber', 'Jonas')], publisher: 'Universität Beispielstadt', 'publisher-place': 'Beispielstadt',
    issued: { 'date-parts': [[2023]] },
  } },
  { label: t('Bericht'), item: {
    id: 'report', type: 'report', title: 'Digitale Kompetenzen an Hochschulen: Bericht 2022', author: [{ literal: 'Bundesamt für Beispiele' }],
    publisher: 'Bundesamt für Beispiele', 'publisher-place': 'Bern', number: '7', issued: { 'date-parts': [[2022]] },
  } },
  { label: t('Herausgegebenes Buch'), item: {
    id: 'edited', type: 'book', title: 'Handbuch Beratung', editor: [person('Huber', 'Tom'), person('Frei', 'Sara')],
    publisher: 'Beispielverlag', 'publisher-place': 'Bern', issued: { 'date-parts': [[2020]] },
  } },
];
