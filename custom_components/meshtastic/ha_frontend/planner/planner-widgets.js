// Drobne widżety DOM panelu plannera (odpowiedniki PlannerWidgets.kt: karta, nagłówek, wiersz wartości, uwaga,
// pole liczbowe, lista rozwijana) oraz okno z objaśnieniem (InfoDialog.kt). Czysty DOM, bez bibliotek.
import { parseNumber, formatField, sameValue } from './planner-format.js';

/** Tworzy element: h('div', {class:'x', onClick: fn}, 'tekst', child, [children]). */
export function h(tag, props, ...children) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') n[k] = true;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return n;
}

/** Tematy objaśnień (nazwa -> przedrostek kluczy info_<nazwa>_title / _body). */
export const INFO_TOPICS = Object.freeze([
  'general', 'points', 'ground_alt', 'antenna_height', 'tx_power', 'antenna_gain', 'feeder', 'feeder_precise', 'frequency',
  'modem', 'sensitivity', 'k_factor', 'weather', 'clutter', 'profile', 'fresnel', 'link_result', 'margin', 'bearing',
  'measured', 'coverage', 'export', 'credits',
]);

const TROPO_URL = 'https://www.dxinfocentre.com/tropo_eur.html';

/**
 * Zestaw widżetów związany z tłumaczeniem `tr` i pamięcią tekstów pól `fieldTexts` (Map key -> {text, value}),
 * dzięki której przebudowa sekcji nie kasuje tego, co użytkownik właśnie wpisuje (jak remember{} w Compose).
 */
export function createWidgets({ tr, fieldTexts, openInfo }) {
  const infoButton = (topic) => h('button', {
    class: 'mlp-info', type: 'button', title: tr('info_button'), 'aria-label': tr('info_button'),
    onClick: (e) => { e.preventDefault(); e.stopPropagation(); openInfo(topic); },
  }, 'i');

  const card = (title, info, ...children) => h('section', { class: 'mlp-card' },
    h('div', { class: 'mlp-card-head' }, h('h3', null, title), info ? infoButton(info) : null),
    h('div', { class: 'mlp-card-body' }, children));

  const subheading = (text, info) => h('div', { class: 'mlp-sub' }, h('span', null, text), info ? infoButton(info) : null);

  const valueRow = (label, value, { bold = false, color = null } = {}) => h('div', { class: 'mlp-row' },
    h('span', { class: 'mlp-row-label' }, label),
    h('span', { class: `mlp-row-value${bold ? ' mlp-bold' : ''}`, style: color ? { color } : null }, value));

  const notice = (text, isError = false) => h('div', { class: `mlp-notice${isError ? ' mlp-notice-error' : ''}`, role: isError ? 'alert' : 'note' },
    h('span', { class: 'mlp-notice-icon', 'aria-hidden': 'true' }, isError ? '!' : 'i'), h('span', null, text));

  const small = (text, cls = '') => h('div', { class: `mlp-small ${cls}`.trim() }, text);

  const button = (text, onClick, { primary = false, disabled = false, title } = {}) => h('button', {
    class: `mlp-btn${primary ? ' mlp-btn-primary' : ''}`, type: 'button', disabled, title, onClick,
  }, text);

  const chip = (text, selected, onClick, { disabled = false } = {}) => h('button', {
    class: `mlp-chip${selected ? ' mlp-chip-on' : ''}`, type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled, onClick,
  }, text);

  const segmented = (options, selected, onSelect) => h('div', { class: 'mlp-seg', role: 'group' },
    options.map(([value, label]) => h('button', {
      class: `mlp-seg-btn${value === selected ? ' mlp-seg-on' : ''}`, type: 'button', 'aria-pressed': value === selected ? 'true' : 'false',
      onClick: () => onSelect(value),
    }, label)));

  const checkRow = (checked, text, onToggle, info) => h('div', { class: 'mlp-check' },
    h('label', null, h('input', { type: 'checkbox', checked, onChange: (e) => onToggle(e.target.checked) }), h('span', null, text)),
    info ? infoButton(info) : null);

  /**
   * Pole liczbowe. Tekst wpisany przez użytkownika zostaje, dopóki jest równoważny wartości modelu.
   * @param {{key:string,label:string,value:number|null,onValue:(n:number)=>void,decimals?:number,suffix?:string,
   *   min?:number,max?:number,supporting?:string,onBlank?:()=>void,enabled?:boolean}} o
   */
  const numberField = (o) => {
    const { key, label, value, onValue, decimals = 2, suffix, min = -1e12, max = 1e12, supporting, onBlank, enabled = true } = o;
    let entry = fieldTexts.get(key);
    let text;
    if (value === null || value === undefined) {
      text = '';
    } else if (!entry) {
      text = formatField(value, decimals);
    } else if (entry.value !== value) {
      const parsed = parseNumber(entry.text);
      text = parsed !== null && sameValue(parsed, value) ? entry.text : formatField(value, decimals);
    } else {
      text = entry.text;
    }
    entry = { text, value: value ?? null };
    fieldTexts.set(key, entry);

    const support = h('div', { class: 'mlp-support' });
    const input = h('input', {
      class: 'mlp-input', type: 'text', inputmode: min < 0 ? 'text' : 'decimal', autocomplete: 'off', 'data-k': key, value: text, disabled: !enabled,
      'aria-label': label,
    });
    const validate = () => {
      const t = input.value;
      const parsed = parseNumber(t);
      const invalid = t.trim() !== '' && (parsed === null || parsed < min || parsed > max);
      input.classList.toggle('mlp-invalid', invalid);
      support.classList.toggle('mlp-support-error', invalid);
      if (invalid) {
        support.textContent = parsed === null ? tr('error_number') : tr('error_range', formatField(min, decimals), formatField(max, decimals));
      } else {
        support.textContent = supporting || '';
      }
    };
    input.addEventListener('input', () => {
      const t = input.value;
      const e = fieldTexts.get(key);
      if (e) e.text = t;
      validate();
      const p = parseNumber(t);
      if (p !== null && p >= min && p <= max) onValue(p);
      else if (t.trim() === '' && onBlank) onBlank();
    });
    validate();
    return h('label', { class: 'mlp-field' },
      h('span', { class: 'mlp-field-label' }, label),
      h('span', { class: 'mlp-input-row' }, input, suffix ? h('span', { class: 'mlp-suffix' }, suffix) : null),
      support);
  };

  const textField = (key, label, value, onValue) => {
    const input = h('input', { class: 'mlp-input', type: 'text', autocomplete: 'off', 'data-k': key, value: value ?? '', 'aria-label': label });
    input.addEventListener('input', () => onValue(input.value));
    return h('label', { class: 'mlp-field' }, h('span', { class: 'mlp-field-label' }, label), h('span', { class: 'mlp-input-row' }, input));
  };

  /** Lista rozwijana; options: [[value,label]], selected porównywane przez String(). */
  const dropdown = (key, label, options, selected, onSelect, { extraOption = null } = {}) => {
    const sel = h('select', { class: 'mlp-select', 'data-k': key, 'aria-label': label });
    if (extraOption) sel.append(h('option', { value: '__extra', selected: selected === null, disabled: true }, extraOption));
    for (const [value, text] of options) {
      sel.append(h('option', { value: String(value), selected: selected !== null && String(value) === String(selected) }, text));
    }
    sel.addEventListener('change', () => {
      const found = options.find(([v]) => String(v) === sel.value);
      if (found) onSelect(found[0]);
    });
    return h('label', { class: 'mlp-field' }, h('span', { class: 'mlp-field-label' }, label), sel);
  };

  return { h, infoButton, card, subheading, valueRow, notice, small, button, chip, segmented, checkRow, numberField, textField, dropdown };
}

/** Okno z objaśnieniem (InfoDialog). Zwraca element do wstawienia w korzeń panelu; zamyka się samo. */
export function buildInfoDialog({ tr, topic, onClose }) {
  const title = tr(`info_${topic}_title`);
  const body = tr(`info_${topic}_body`);
  const paragraphs = String(body).split('\n\n').map((p) => h('p', null, ...p.split('\n').flatMap((line, i, arr) => (i < arr.length - 1 ? [line, h('br')] : [line]))));
  const closeBtn = h('button', { class: 'mlp-btn mlp-btn-primary', type: 'button', onClick: onClose }, tr('close'));
  const dialog = h('div', { class: 'mlp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', { class: 'mlp-dialog-title' }, title),
    h('div', { class: 'mlp-dialog-body' }, paragraphs,
      topic === 'weather' ? h('a', { class: 'mlp-btn mlp-btn-text', href: TROPO_URL, target: '_blank', rel: 'noopener noreferrer' }, tr('open_tropo_reference')) : null),
    h('div', { class: 'mlp-dialog-actions' }, closeBtn));
  const backdrop = h('div', { class: 'mlp-backdrop', onClick: (e) => { if (e.target === backdrop) onClose(); } }, dialog);
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } });
  setTimeout(() => closeBtn.focus(), 0);
  return backdrop;
}
