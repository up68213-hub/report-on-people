import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function useDialogFocus(open, onEscape) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);
  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => element.getClientRects().length);
    const frame = requestAnimationFrame(() => (dialog?.querySelector('[data-autofocus]') || focusable()[0] || dialog)?.focus?.());
    const keyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escapeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog?.addEventListener('keydown', keyDown);
    return () => {
      cancelAnimationFrame(frame); dialog?.removeEventListener('keydown', keyDown);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [open]);
  return dialogRef;
}

function optionItems(options) {
  return options.map((option) => typeof option === 'object'
    ? { value: String(option.value), label: String(option.label) }
    : { value: String(option), label: String(option) });
}

export function ComboBox({ options = [], value = '', onChange, placeholder = 'Выберите', disabled = false,
  allowCustom = false, clearable = true, className = '', invalid = false, ariaLabel }) {
  const id = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const items = useMemo(() => optionItems(options), [options]);
  const selected = items.find((item) => item.value === String(value));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);
  const focusValueRef = useRef(null);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru-RU');
    if (!search || query === selected?.label) return items;
    return items.filter((item) => item.label.toLocaleLowerCase('ru-RU').includes(search));
  }, [items, query, selected?.label]);

  useEffect(() => { setQuery(selected?.label ?? (allowCustom ? String(value || '') : '')); }, [selected?.label, value, allowCustom]);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === String(value)));
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const roomBelow = window.innerHeight - rect.bottom - 8;
      const roomAbove = rect.top - 8;
      const maxHeight = Math.max(120, Math.min(280, Math.max(roomBelow, roomAbove) - 6));
      const opensUp = roomBelow < 180 && roomAbove > roomBelow;
      setPosition({ left, top: opensUp ? undefined : rect.bottom + 6, bottom: opensUp ? window.innerHeight - rect.top + 6 : undefined, width, maxHeight });
    };
    updatePosition();
    const close = (event) => {
      if (rootRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      setOpen(false);
      if (allowCustom) onChange(query.trim());
      else setQuery(selected?.label || '');
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, allowCustom, onChange, query, selected?.label]);

  const openList = ({ selectText = false } = {}) => {
    if (disabled) return;
    setOpen(true);
    setActive(selectedIndex);
    if (selectText) requestAnimationFrame(() => inputRef.current?.select());
  };
  const choose = (item) => {
    onChange(item.value);
    setQuery(item.label);
    setOpen(false);
    setActive(0);
  };
  const commitCustom = () => {
    if (!query.trim() && focusValueRef.current) {
      const previous = focusValueRef.current;
      setQuery(previous.label);
      if (allowCustom) onChange(previous.value);
      focusValueRef.current = null;
      return;
    }
    focusValueRef.current = null;
    if (!allowCustom) {
      setQuery(selected?.label || '');
      return;
    }
    const exact = items.find((item) => item.label.toLocaleLowerCase('ru-RU') === query.trim().toLocaleLowerCase('ru-RU'));
    onChange(exact?.value || query.trim());
  };
  const keyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { openList(); return; }
      setActive((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const exact = items.find((item) => item.label.toLocaleLowerCase('ru-RU') === query.trim().toLocaleLowerCase('ru-RU'));
      if (allowCustom && query.trim() && !exact) commitCustom();
      else if (open && filtered[active]) choose(filtered[active]);
      else commitCustom();
    } else if (event.key === 'Escape') {
      event.preventDefault(); setOpen(false); setQuery(selected?.label ?? (allowCustom ? String(value || '') : ''));
    }
  };

  const dropdown = open && position && createPortal(<div ref={listRef} id={`${id}-list`} role="listbox" className="ui-combobox-list"
    style={{ left: position.left, top: position.top, width: position.width }}>
    {filtered.length ? filtered.map((item, index) => <button type="button" role="option" key={`${item.value}-${index}`}
      aria-selected={item.value === String(value)} className={`${index === active ? 'active' : ''} ${item.value === String(value) ? 'selected' : ''}`}
      onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
      <span>{item.label}</span>{item.value === String(value) && <b>✓</b>}
    </button>) : <div className="ui-combobox-empty">{allowCustom ? 'Нажмите Enter, чтобы добавить' : 'Ничего не найдено'}</div>}
  </div>, document.body);

  return <div ref={rootRef} className={`ui-combobox ${open ? 'open' : ''} ${clearable ? 'clearable' : ''} ${invalid ? 'invalid' : ''} ${className}`}>
    <input ref={inputRef} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={`${id}-list`}
      aria-autocomplete="list" autoComplete="off" value={query} disabled={disabled} placeholder={placeholder}
      onFocus={() => {
        focusValueRef.current = { value: String(value || ''), label: selected?.label ?? String(value || '') };
        openList({ selectText: true });
      }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); if (allowCustom) onChange(event.target.value); }}
      onBlur={commitCustom} onKeyDown={keyDown} />
    {clearable && !!query && !disabled && <button type="button" className="ui-combobox-clear" aria-label="Очистить"
      onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); onChange(''); inputRef.current?.focus(); }}>×</button>}
    <button type="button" className="ui-combobox-arrow" aria-label="Открыть список" disabled={disabled}
      aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (open) { setOpen(false); inputRef.current?.focus(); }
        else { inputRef.current?.focus(); openList(); }
      }}>⌄</button>
    {dropdown}
  </div>;
}

export function ClearableInput({ value = '', onChange, className = '', clearLabel = 'Очистить поле', ...props }) {
  return <span className={`ui-clearable-input ${className}`}>
    <input {...props} value={value} onChange={onChange} />
    {String(value).length > 0 && !props.disabled && <button type="button" className="ui-input-clear" aria-label={clearLabel}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChange({ target: { value: '' } })}>×</button>}
  </span>;
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3.5v3M16 3.5v3M3.5 9.5h17" /></svg>;
}

export function CalendarField({ value = '', onChange, allowedDates = null, disabled = false, invalid = false, className = '', ariaLabel = 'Дата' }) {
  const rootRef = useRef(null);
  const popupRef = useRef(null);
  const selected = parseDate(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selected || new Date());
  const [position, setPosition] = useState(null);
  const allowed = useMemo(() => allowedDates ? new Set(allowedDates) : null, [allowedDates]);
  useEffect(() => { if (selected) setMonth(selected); }, [value]);
  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 302)), top: rect.bottom + 6 });
    const close = (event) => {
      if (rootRef.current?.contains(event.target) || popupRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  const monthLabel = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const display = selected ? selected.toLocaleDateString('ru-RU') : '';
  const popup = open && position && createPortal(<div ref={popupRef} className="ui-calendar" style={position}>
    <div className="ui-calendar-head"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{monthLabel}</strong><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
    <div className="ui-calendar-week">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="ui-calendar-days">{days.map((day) => {
      const iso = isoDate(day); const enabled = !allowed || allowed.has(iso); const adjacent = day.getMonth() !== month.getMonth();
      return <button type="button" key={iso} disabled={!enabled} className={`${adjacent ? 'adjacent' : ''} ${iso === value ? 'selected' : ''} ${iso === isoDate(new Date()) ? 'today' : ''}`}
        onClick={() => { onChange(iso); setOpen(false); }}>{day.getDate()}</button>;
    })}</div>
  </div>, document.body);
  return <div ref={rootRef} className={`ui-date-field ${invalid ? 'invalid' : ''} ${className}`}>
    <button type="button" className="ui-date-input" aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen((current) => !current)}><span>{display || 'Выберите дату'}</span><span className="ui-date-icon"><CalendarIcon /></span></button>
    {popup}
  </div>;
}

export function DateRangeField({ start = '', end = '', onChange, allowedDates = null, disabled = false, className = '', ariaLabel = 'Дата или период', placeholder = 'Выберите дату или период', clearable = false }) {
  const rootRef = useRef(null);
  const popupRef = useRef(null);
  const initial = parseDate(start) || parseDate(end) || new Date();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(start && end && start !== end ? 'range' : 'single');
  const [month, setMonth] = useState(initial);
  const [rangeStart, setRangeStart] = useState('');
  const [position, setPosition] = useState(null);
  const allowed = useMemo(() => allowedDates ? new Set(allowedDates) : null, [allowedDates]);
  useEffect(() => { if (start) setMonth(parseDate(start)); }, [start]);
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 302, window.innerWidth - 310)), top: rect.bottom + 6 });
    };
    updatePosition();
    const close = (event) => {
      if (rootRef.current?.contains(event.target) || popupRef.current?.contains(event.target)) return;
      setOpen(false); setRangeStart('');
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(gridStart); day.setDate(gridStart.getDate() + index); return day; });
  const choose = (iso) => {
    if (mode === 'single') { onChange(iso, iso); setOpen(false); return; }
    if (!rangeStart) { setRangeStart(iso); return; }
    const nextStart = rangeStart < iso ? rangeStart : iso; const nextEnd = rangeStart < iso ? iso : rangeStart;
    onChange(nextStart, nextEnd); setRangeStart(''); setOpen(false);
  };
  const display = start ? (end && end !== start ? `${formatUiDate(start)} — ${formatUiDate(end)}` : formatUiDate(start)) : '';
  const popup = open && position && createPortal(<div ref={popupRef} className="ui-calendar ui-range-calendar" style={position}>
    <div className="ui-range-modes"><button type="button" className={mode === 'single' ? 'active' : ''} onClick={() => { setMode('single'); setRangeStart(''); }}>Одна дата</button><button type="button" className={mode === 'range' ? 'active' : ''} onClick={() => { setMode('range'); setRangeStart(''); }}>Период</button></div>
    <div className="ui-calendar-head"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</strong><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
    <div className="ui-calendar-week">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="ui-calendar-days">{days.map((day) => {
      const iso = isoDate(day); const enabled = !allowed || allowed.has(iso); const selected = iso === start || iso === end || iso === rangeStart;
      const inRange = Boolean(start && end && start !== end && iso > start && iso < end);
      return <button type="button" key={iso} disabled={!enabled} className={`${day.getMonth() !== month.getMonth() ? 'adjacent' : ''} ${selected ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${iso === isoDate(new Date()) ? 'today' : ''}`} onClick={() => choose(iso)}>{day.getDate()}</button>;
    })}</div>
    {mode === 'range' && <div className="ui-range-hint">{rangeStart ? 'Выберите окончание периода' : 'Выберите начало периода'}</div>}
  </div>, document.body);
  return <div ref={rootRef} className={`ui-date-field ui-range-field ${display && clearable ? 'clearable' : ''} ${className}`}><button type="button" className="ui-date-input" aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen((value) => !value)}><span>{display || placeholder}</span><span className="ui-date-icon"><CalendarIcon /></span></button>{display && clearable && !disabled && <button type="button" className="ui-date-clear" aria-label="Очистить период" onClick={(event) => { event.stopPropagation(); setRangeStart(''); setOpen(false); onChange('', ''); }}>×</button>}{popup}</div>;
}

function formatUiDate(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('ru-RU') : '';
}

export function NonNegativeIntegerInput({ value, onChange, invalid = false, placeholder = '' }) {
  return <input type="text" inputMode="numeric" pattern="[0-9]*" value={value} placeholder={placeholder} className={invalid ? 'invalid' : ''}
    onFocus={(event) => event.target.select()}
    onChange={(event) => { if (/^\d*$/.test(event.target.value)) onChange(event.target.value); }}
    onPaste={(event) => { const text = event.clipboardData.getData('text'); if (!/^\d+$/.test(text)) event.preventDefault(); }} />;
}

export function ReplaceOnFocusInput({ value, onChange, ...props }) {
  return <input {...props} value={value}
    onFocus={(event) => { event.target.select(); props.onFocus?.(event); }}
    onChange={(event) => onChange(event.target.value)} />;
}
