import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import Dialog from './Dialog.jsx';
import { ComboBox, DateRangeField } from './UiControls.jsx';

const QUALITY_CRITERIA = [
  ['Качество выполнения работ', 'work_quality_fact'],
  ['Дисциплина (ТБ, охрана труда, СИЗ)', 'discipline_fact'],
  ['Количество людей на объекте', 'people_count_fact'],
  ['Выполнение запланированного объёма', 'productivity_fact'],
  ['Чистота на рабочем месте', 'cleanliness_fact'],
];

const DETAIL_KEYS = ['date', 'object', 'contractor', 'work', 'quality', 'plan', 'fact', 'deviation', 'cause', 'decision', 'comment', 'status'];
const QUALITY_KEYS = ['date', 'contractor', 'object', 'work', 'quality', 'plan', 'deviation', 'decision', 'comment', 'status'];
const REQUIRED_KEYS = ['date', 'object', 'contractor'];
const STICKY_WIDTH = { date: 108, object: 170, contractor: 190 };
const COLUMN_LABELS = {
  date: 'Дата', object: 'Объект', contractor: 'Подрядчик', work: 'Вид работы', quality: 'Качество',
  plan: 'План', fact: 'Факт', deviation: 'Отклонение', cause: 'Причина', decision: 'Решение РП',
  comment: 'Комментарий', status: 'Отработано',
};

function isOwnForces(row) {
  return [row.work_type, row.contractor].some((value) => String(value || '').trim().toLocaleLowerCase('ru-RU') === 'собственные силы');
}

function rowKey(row) {
  return [row.object_id, row.report_date, row.work_type, row.detail || '', row.contractor || ''].join('\u001f');
}

function identity(row) {
  return {
    objectId: Number(row.object_id), reportDate: row.report_date,
    workType: row.work_type, detail: row.detail || '', contractor: row.contractor || '',
  };
}

function formatDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU') : '—';
}

function qualityClass(value) {
  if (value === null || value === undefined) return '';
  if (Number(value) < 3) return 'resource-quality-low';
  if (Number(value) < 4) return 'resource-quality-mid';
  return 'resource-quality-high';
}

function decisionClass(value) {
  const text = String(value || '');
  if (/замен|приостан|не выбран/i.test(text)) return 'resource-badge-danger';
  if (/претенз|уведомл/i.test(text)) return 'resource-badge-warning';
  if (/усилен/i.test(text)) return 'resource-badge-info';
  return 'resource-badge-muted';
}

function QualityValue({ row }) {
  if (row.quality_score === null || row.quality_score === undefined) return '—';
  const selected = QUALITY_CRITERIA.filter(([, field]) => row[field]);
  return <span className="resource-quality-tip" tabIndex="0">
    <strong className={qualityClass(row.quality_score)}>{Number(row.quality_score).toFixed(1)}</strong>
    <span className="resource-quality-tooltip" role="tooltip"><b>Критерии оценки РП</b>{selected.length ? selected.map(([label, field]) => <span key={field}><em>{label} · 20%</em><small>{row[field]}</small></span>) : <small>Критерии не заполнены</small>}</span>
  </span>;
}

function sortRows(rows, sort) {
  if (!sort.field) return rows;
  return [...rows].sort((a, b) => {
    let left = a[sort.field]; let right = b[sort.field];
    if (left === null || left === undefined) left = '';
    if (right === null || right === undefined) right = '';
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * sort.direction;
    return String(left).localeCompare(String(right), 'ru', { numeric: true }) * sort.direction;
  });
}

function normalizeLayout(saved, allKeys, required) {
  const order = [];
  for (const key of saved?.order || allKeys) {
    if (allKeys.includes(key) && !order.includes(key)) order.push(key);
  }
  for (const key of allKeys) if (!order.includes(key)) order.push(key);
  const hidden = [...new Set((saved?.hidden || []).filter((key) => allKeys.includes(key) && !required.includes(key)))];
  return { order, hidden };
}

function readLayout(storageKey, allKeys, required) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) return normalizeLayout(saved, allKeys, required);
    const legacy = JSON.parse(localStorage.getItem('resource-columns') || 'null');
    if (legacy) {
      return normalizeLayout({
        order: allKeys,
        hidden: allKeys.filter((key) => legacy[key] === false),
      }, allKeys, required);
    }
  } catch { /* keep defaults */ }
  return normalizeLayout({ order: allKeys, hidden: ['plan', 'fact', 'cause', 'decision', 'comment', 'status'] }, allKeys, required);
}

function useUserTableLayout(userId, tableKey, allKeys, required) {
  const storageKey = `people-report-u${userId || 'anon'}-cols-${tableKey}`;
  const [layout, setLayout] = useState(() => readLayout(storageKey, allKeys, required));
  useEffect(() => { setLayout(readLayout(storageKey, allKeys, required)); }, [storageKey]);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(layout)); }, [storageKey, layout]);
  const visibleKeys = layout.order.filter((key) => !layout.hidden.includes(key));
  const toggle = (key) => {
    if (required.includes(key)) return;
    setLayout((current) => ({
      ...current,
      hidden: current.hidden.includes(key) ? current.hidden.filter((item) => item !== key) : [...current.hidden, key],
    }));
  };
  const move = (fromKey, toIndex) => {
    if (!fromKey) return;
    setLayout((current) => {
      const order = current.order.filter((key) => key !== fromKey);
      order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, fromKey);
      return { ...current, order };
    });
  };
  return { layout, visibleKeys, toggle, move };
}

function stickyStyle(key, visibleKeys) {
  if (!STICKY_WIDTH[key]) return undefined;
  const pinned = visibleKeys.filter((item) => STICKY_WIDTH[item]);
  const index = pinned.indexOf(key);
  if (index < 0) return undefined;
  let left = 0;
  for (let i = 0; i < index; i += 1) left += STICKY_WIDTH[pinned[i]];
  return { left: `${left}px`, width: STICKY_WIDTH[key], minWidth: STICKY_WIDTH[key] };
}

function ColumnMenu({ layout, required, onToggle, onMove, onClose }) {
  const rootRef = useRef(null);
  const dragKey = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!rootRef.current?.contains(event.target)) onClose(); };
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);
  return <div ref={rootRef} className="resource-columns-menu">
    <p>Перетащите строку, чтобы изменить порядок. Настройки хранятся только у вас.</p>
    {layout.order.map((key, index) => <div key={key} className="resource-columns-item" draggable
      onDragStart={() => { dragKey.current = key; }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onMove(dragKey.current, index)}>
      <span className="resource-columns-handle" aria-hidden="true">⋮⋮</span>
      <label>
        <input type="checkbox" checked={!layout.hidden.includes(key)} disabled={required.includes(key)} onChange={() => onToggle(key)} />
        <span>{COLUMN_LABELS[key]}</span>
      </label>
    </div>)}
  </div>;
}

function ErrorDialog({ error, onClose }) {
  return <Dialog open={Boolean(error)} onClose={onClose} overlayClassName="resource-error-overlay" modalClassName="resource-error-modal"
    role="alertdialog" title="Не удалось выполнить действие" footer={<button type="button" onClick={onClose}>Понятно</button>}>
    <div className="resource-error-subtitle">Проверьте данные и повторите попытку</div>
    <div className="resource-error-message"><span>!</span><p>{error}</p></div>
  </Dialog>;
}

function Pagination({ page, total, pageSize, onChange, onPageSizeChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visible = Array.from({ length: pages }, (_, index) => index + 1).filter((number) => number === 1 || number === pages || Math.abs(number - page) <= 1);
  return <div className="resource-pagination"><div className="resource-page-size"><span>Строк на странице</span><ComboBox value={pageSize} onChange={(value) => onPageSizeChange(Number(value))} options={[20, 50, 100]} /></div><span>Показано {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} из {total}</span><div><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button>{visible.map((number, index) => <span key={number}>{index > 0 && number - visible[index - 1] > 1 && <i>…</i>}<button type="button" className={number === page ? 'active' : ''} onClick={() => onChange(number)}>{number}</button></span>)}<button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>›</button></div></div>;
}

function ResourceSkeleton({ columns }) {
  return Array.from({ length: 6 }, (_, row) => <tr key={row}>{Array.from({ length: columns }, (_, col) => <td key={col}><span className="resource-skeleton-cell" /></td>)}</tr>);
}

export default function ResourceDepartmentPage({ canEdit = false, objects, selectedObject, setSelectedObject, dates, date, records, notify, userId }) {
  const [fromDate, setFromDate] = useState(date || '');
  const [toDate, setToDate] = useState(date || '');
  const [periodError, setPeriodError] = useState('');
  const [stateFilter, setStateFilter] = useState(() => localStorage.getItem('resource-state-filter') || 'open');
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('resource-active-tab') || 'detail');
  const [comments, setComments] = useState({});
  const [qualityWork, setQualityWork] = useState({});
  const [savedComments, setSavedComments] = useState({});
  const [savingKeys, setSavingKeys] = useState(new Set());
  const [loadingWork, setLoadingWork] = useState(false);
  const [rowErrors, setRowErrors] = useState({});
  const [detailSort, setDetailSort] = useState({ field: 'report_date', direction: -1 });
  const [qualitySort, setQualitySort] = useState({ field: 'name', direction: 1 });
  const [detailPage, setDetailPage] = useState(() => Number(localStorage.getItem('resource-detail-page')) || 1);
  const [qualityPage, setQualityPage] = useState(() => Number(localStorage.getItem('resource-quality-page')) || 1);
  const [pageSize, setPageSize] = useState(() => [20, 50, 100].includes(Number(localStorage.getItem('resource-page-size'))) ? Number(localStorage.getItem('resource-page-size')) : 20);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const tableWrapRef = useRef(null);
  const [orderPulse, setOrderPulse] = useState(0);
  const [selectedWork, setSelectedWork] = useState(null);
  const detailLayout = useUserTableLayout(userId, 'resource-detail', DETAIL_KEYS, REQUIRED_KEYS);
  const qualityLayout = useUserTableLayout(userId, 'resource-quality', QUALITY_KEYS, REQUIRED_KEYS);
  const layout = activeTab === 'detail' ? detailLayout : qualityLayout;

  useEffect(() => {
    if (!dates.length) { setFromDate(''); setToDate(''); return; }
    const start = date && dates.includes(date) ? date : dates.at(-1);
    setFromDate(start);
    setToDate(start);
    setPeriodError('');
  }, [dates, date]);

  useEffect(() => {
    let active = true;
    const pairs = [...new Map(records.map((row) => [`${row.object_id}\u001f${row.report_date}`, row])).values()];
    if (!pairs.length) { setComments({}); setQualityWork({}); setSavedComments({}); return undefined; }
    setLoadingWork(true);
    Promise.all(pairs.map(async (row) => ({
      row,
      data: await api(`/api/resource-work?objectId=${encodeURIComponent(row.object_id)}&reportDate=${encodeURIComponent(row.report_date)}`),
    }))).then((results) => {
      if (!active) return;
      const nextComments = {}; const nextQuality = {};
      results.forEach(({ row, data }) => {
        data.comments.forEach((item) => {
          const key = rowKey({ ...row, work_type: item.workType, detail: item.detail, contractor: item.contractor });
          nextComments[key] = item.comment;
        });
        data.quality.forEach((item) => {
          const key = rowKey({ ...row, work_type: item.workType, detail: item.detail, contractor: item.contractor });
          nextQuality[key] = { isResolved: item.isResolved, comment: item.comment || '', updatedAt: item.updatedAt, updatedBy: item.updatedBy };
        });
      });
      setComments(nextComments); setSavedComments(nextComments); setQualityWork(nextQuality);
    }).catch((error) => active && notify(`Не удалось загрузить данные департамента ресурсов. ${error.message}`, 'error'))
      .finally(() => active && setLoadingWork(false));
    return () => { active = false; };
  }, [records]);

  const filteredRows = useMemo(() => records.filter((row) => {
    if (isOwnForces(row)) return false;
    if (fromDate && row.report_date < fromDate) return false;
    if (toDate && row.report_date > toDate) return false;
    const resolved = Boolean(qualityWork[rowKey(row)]?.isResolved);
    if (stateFilter === 'open' && resolved) return false;
    if (stateFilter === 'done' && !resolved) return false;
    return true;
  }), [records, fromDate, toDate, stateFilter, qualityWork]);

  const detailRows = useMemo(() => sortRows(filteredRows.map((row) => ({
    ...row, deviation: Number(row.actual_people || 0) - Number(row.plan_people || 0),
    resolved: Number(Boolean(qualityWork[rowKey(row)]?.isResolved)),
  })), detailSort), [filteredRows, qualityWork, detailSort]);

  const qualityRows = useMemo(() => {
    const rows = filteredRows.filter((row) => row.quality_score !== null && row.quality_score !== undefined).map((row) => {
      const work = qualityWork[rowKey(row)] || { isResolved: false, comment: '' };
      return {
        ...row, rows: [row], name: row.contractor || 'Подрядчик не указан', worksLabel: row.work_type,
        quality: Number(row.quality_score), plan: Number(row.plan_people || 0),
        deviation: Number(row.actual_people || 0) - Number(row.plan_people || 0),
        decision: row.decision || 'Не принял решений', comment: work.comment || '', resolved: Boolean(work.isResolved),
      };
    });
    return sortRows(rows, qualitySort);
  }, [filteredRows, qualityWork, qualitySort]);

  const setSaving = (keys, enabled) => setSavingKeys((current) => {
    const next = new Set(current); keys.forEach((key) => enabled ? next.add(key) : next.delete(key)); return next;
  });

  const validatePeriod = (nextFrom = fromDate, nextTo = toDate) => {
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setPeriodError('Дата начала не может быть позже даты окончания.'); return false;
    }
    setPeriodError('');
    return true;
  };

  const saveComment = async (row) => {
    const key = rowKey(row); const comment = String(comments[key] || '').trim();
    if (comment === String(savedComments[key] || '').trim()) return;
    if (!comment) { setComments((current) => ({ ...current, [key]: savedComments[key] || '' })); return; }
    setSaving([key], true);
    try {
      await api('/api/feedback', { method: 'PUT', body: JSON.stringify({ ...identity(row), comment }) });
      setComments((current) => ({ ...current, [key]: comment }));
      setSavedComments((current) => ({ ...current, [key]: comment }));
      setRowErrors((current) => ({ ...current, [key]: '' }));
      notify('Комментарий департамента сохранён');
    } catch (error) { notify(`Комментарий не сохранён. ${error.message}`, 'error', () => saveComment(row)); }
    finally { setSaving([key], false); }
  };

  const toggleRowResolved = async (row, isResolved) => {
    const key = rowKey(row); const comment = String(comments[key] || '').trim();
    if (isResolved && !comment) {
      setRowErrors((current) => ({ ...current, [key]: 'Сначала напишите комментарий. Без него строку нельзя отметить отработанной.' }));
      return;
    }
    setSaving([key], true);
    try {
      if (comment && comment !== String(savedComments[key] || '').trim()) {
        await api('/api/feedback', { method: 'PUT', body: JSON.stringify({ ...identity(row), comment }) });
        setSavedComments((current) => ({ ...current, [key]: comment }));
      }
      const current = qualityWork[key] || { comment: '' };
      await api('/api/resource-work/quality', { method: 'PUT', body: JSON.stringify({ ...identity(row), comment: current.comment || '', isResolved }) });
      setQualityWork((value) => ({ ...value, [key]: { ...current, isResolved, updatedAt: new Date().toISOString(), updatedBy: 'Вы' } }));
      setRowErrors((current) => ({ ...current, [key]: '' }));
      notify(isResolved ? 'Строка помечена отработанной' : 'Отметка снята');
    } catch (error) { notify(`Статус строки не изменён. ${error.message}`, 'error', () => toggleRowResolved(row, isResolved)); }
    finally { setSaving([key], false); }
  };

  const saveQualityGroup = async (group, comment, isResolved) => {
    const key = rowKey(group);
    const cleanComment = String(comment || '').trim();
    if (isResolved && !cleanComment) return false;
    const keys = group.rows.map(rowKey); setSaving(keys, true);
    try {
      await Promise.all(group.rows.map((row) => api('/api/resource-work/quality', {
        method: 'PUT', body: JSON.stringify({ ...identity(row), comment: cleanComment, isResolved }),
      })));
      setQualityWork((current) => {
        const next = { ...current }; group.rows.forEach((row) => { next[rowKey(row)] = { isResolved, comment: cleanComment, updatedAt: new Date().toISOString(), updatedBy: 'Вы' }; }); return next;
      });
      setRowErrors((current) => ({ ...current, [key]: '' }));
      notify('Работа с подрядчиком сохранена');
      return true;
    } catch (error) { notify(`Данные по подрядчику не сохранены. ${error.message}`, 'error', () => saveQualityGroup(group, comment, isResolved)); return false; }
    finally { setSaving(keys, false); }
  };

  const changeSort = (setter, field) => setter((current) => ({ field, direction: current.field === field ? -current.direction : 1 }));
  const SortLabel = ({ label, field, sort, onSort }) => <button type="button" className="resource-sort" onClick={() => onSort(field)}>{label}{sort.field === field && <span>{sort.direction > 0 ? '▲' : '▼'}</span>}</button>;
  const deficit = filteredRows.reduce((sum, row) => sum + Number(row.actual_people || 0) - Number(row.plan_people || 0), 0);
  const doneCount = filteredRows.filter((row) => qualityWork[rowKey(row)]?.isResolved).length;
  const lowQualityCount = qualityRows.filter((row) => row.quality < 3).length;
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return; }
    setDetailPage(1); setQualityPage(1);
  }, [fromDate, toDate, stateFilter, selectedObject]);
  const visibleDetailRows = detailRows.slice((detailPage - 1) * pageSize, detailPage * pageSize);
  const visibleQualityRows = qualityRows.slice((qualityPage - 1) * pageSize, qualityPage * pageSize);
  useEffect(() => { localStorage.setItem('resource-detail-page', String(detailPage)); }, [detailPage]);
  useEffect(() => { localStorage.setItem('resource-quality-page', String(qualityPage)); }, [qualityPage]);
  useEffect(() => { localStorage.setItem('resource-page-size', String(pageSize)); setDetailPage(1); setQualityPage(1); }, [pageSize]);
  useEffect(() => { localStorage.setItem('resource-state-filter', stateFilter); }, [stateFilter]);
  useEffect(() => { localStorage.setItem('resource-active-tab', activeTab); }, [activeTab]);
  useEffect(() => {
    tableWrapRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setOrderPulse((value) => value + 1);
  }, [detailSort, qualitySort, stateFilter, fromDate, toDate, activeTab]);

  const sortField = {
    date: 'report_date', object: 'object_name', contractor: 'contractor', work: 'work_type',
    quality: 'quality_score', plan: 'plan_people', fact: 'actual_people', deviation: 'deviation',
    cause: 'cause', decision: 'decision', status: 'resolved',
  };
  const qualitySortField = { ...sortField, contractor: 'name', quality: 'quality', plan: 'plan' };

  const renderHeader = (key, sort, onSort, fields) => {
    const className = STICKY_WIDTH[key] ? 'sticky-col' : '';
    const style = stickyStyle(key, layout.visibleKeys);
    const field = fields[key];
    const label = key === 'date' && activeTab === 'quality' ? 'Дата отчёта РП' : COLUMN_LABELS[key];
    return <th key={key} className={className} style={style}>{field
      ? <SortLabel label={label} field={field} sort={sort} onSort={onSort} />
      : label}</th>;
  };

  const renderDetailCell = (key, row) => {
    const className = STICKY_WIDTH[key] ? `sticky-col${key === 'date' ? ' nowrap' : ''}` : '';
    const style = stickyStyle(key, layout.visibleKeys);
    const resolved = Boolean(qualityWork[rowKey(row)]?.isResolved);
    const error = rowErrors[rowKey(row)];
    const cells = {
      date: <td key={key} className={`${className} nowrap`} style={style}>{formatDate(row.report_date)}</td>,
      object: <td key={key} className={className} style={style}><strong>{row.object_name}</strong></td>,
      contractor: <td key={key} className={className} style={style}>{row.contractor || '—'}</td>,
      work: <td key={key}>{row.work_type}{row.detail ? <small>{row.detail}</small> : null}</td>,
      quality: <td key={key}><QualityValue row={row} /></td>,
      plan: <td key={key} className="number">{row.plan_people ?? '—'}</td>,
      fact: <td key={key} className="number">{row.actual_people ?? '—'}</td>,
      deviation: <td key={key} className={`number ${row.deviation < 0 ? 'value-negative' : 'value-positive'}`}>{row.deviation > 0 ? '+' : ''}{row.deviation}</td>,
      cause: <td key={key}>{row.cause || '—'}</td>,
      decision: <td key={key}><span className={`resource-decision-badge ${decisionClass(row.decision)}`}>{row.decision || 'Не принял решений'}</span></td>,
      comment: <td key={key} className="resource-comment-cell"><textarea rows="2" value={comments[rowKey(row)] || ''} disabled={!canEdit || savingKeys.has(rowKey(row))} maxLength={2000} placeholder={canEdit ? 'Что сделал департамент ресурсов…' : 'Только для просмотра'} onChange={(event) => { setComments((current) => ({ ...current, [rowKey(row)]: event.target.value })); setRowErrors((current) => ({ ...current, [rowKey(row)]: '' })); }} onBlur={() => canEdit && saveComment(row)} />{error && <small className="resource-field-error">{error}</small>}{savingKeys.has(rowKey(row)) && <small>сохранение…</small>}</td>,
      status: <td key={key}><label className="resource-check"><input type="checkbox" checked={resolved} disabled={!canEdit || savingKeys.has(rowKey(row))} onChange={(event) => toggleRowResolved(row, event.target.checked)} /><span>✓</span></label></td>,
    };
    return cells[key];
  };

  return <div className="section-page resource-page-v3">
    <div className="resource-v3-header">
      <div className="resource-heading-copy"><h1>ДЕПАРТАМЕНТ <span className="accent">РЕСУРСОВ</span></h1><p>Отработка отчёта по людям: дефицит персонала и качество подрядчиков</p>{!canEdit && <span className="readonly-badge">Только просмотр</span>}</div>
      <div className="resource-filters">
        <label><span>Объект</span><ComboBox value={selectedObject} onChange={setSelectedObject} options={[{ value: 'all', label: 'Все объекты' }, ...objects.map((item) => ({ value: item.id, label: item.name }))]} /></label>
        <div className="resource-period"><span>Дата / период</span><DateRangeField start={fromDate} end={toDate} onChange={(start, end) => { if (validatePeriod(start, end)) { setFromDate(start); setToDate(end); } }} allowedDates={dates} />{periodError && <small className="resource-field-error">{periodError}</small>}</div>
        <label className="resource-status-select"><span>Показать</span><ComboBox value={stateFilter} onChange={setStateFilter} options={[{ value: 'all', label: 'Все' }, { value: 'open', label: 'Не отработано' }, { value: 'done', label: 'Отработано' }]} /></label>
        <div className="resource-filter-info">{loadingWork ? 'Загрузка…' : `${filteredRows.length} строк`}</div>
      </div>
    </div>

    <section className="resource-v3-panel">
      <div className="resource-panel-head"><div className="resource-tabs" role="tablist"><button type="button" role="tab" aria-selected={activeTab === 'detail'} className={activeTab === 'detail' ? 'active' : ''} onClick={() => setActiveTab('detail')}>Детализация по людям</button><button type="button" role="tab" aria-selected={activeTab === 'quality'} className={activeTab === 'quality' ? 'active' : ''} onClick={() => setActiveTab('quality')}>Сводная оценка качества</button></div>
        <div className="resource-panel-actions">{activeTab === 'detail' ? <div className="resource-kpis"><div><strong className={deficit < 0 ? 'bad' : deficit > 0 ? 'ok' : ''}>{deficit > 0 ? `+${deficit}` : deficit}</strong><span>отклонение, чел.</span></div><div><strong className="mid">{filteredRows.length - doneCount}</strong><span>не отработано</span></div><div><strong className="ok">{doneCount}</strong><span>отработано</span></div></div> : <div className="resource-kpis"><div><strong>{qualityRows.length}</strong><span>оценок за даты</span></div><div><strong className="bad">{lowQualityCount}</strong><span>ниже 3,0</span></div></div>}
          <div className="resource-columns-control"><button type="button" onClick={() => setColumnsOpen((value) => !value)}>Колонки</button>{columnsOpen && <ColumnMenu layout={layout.layout} required={REQUIRED_KEYS} onToggle={layout.toggle} onMove={layout.move} onClose={() => setColumnsOpen(false)} />}</div>
        </div>
      </div>

      {activeTab === 'detail' && <div ref={tableWrapRef} key={`detail-${orderPulse}`} className="resource-v3-table-wrap order-updated"><table className="resource-v3-table"><thead><tr>
        {layout.visibleKeys.map((key) => renderHeader(key, detailSort, (field) => changeSort(setDetailSort, field), sortField))}
      </tr></thead><tbody>{loadingWork ? <ResourceSkeleton columns={layout.visibleKeys.length} /> : visibleDetailRows.length ? visibleDetailRows.map((row) => {
        const resolved = Boolean(qualityWork[rowKey(row)]?.isResolved);
        return <tr key={rowKey(row)} tabIndex="0" onClick={() => setSelectedWork(row)} className={`${resolved ? 'resolved ' : ''}resource-action-row`}>{layout.visibleKeys.map((key) => renderDetailCell(key, row))}</tr>;
      }) : <tr><td colSpan={layout.visibleKeys.length} className="resource-empty">По выбранным фильтрам строк нет.</td></tr>}</tbody></table></div>}
      {activeTab === 'detail' && <Pagination page={detailPage} total={detailRows.length} pageSize={pageSize} onChange={setDetailPage} onPageSizeChange={setPageSize} />}

      {activeTab === 'quality' && <div ref={tableWrapRef} key={`quality-${orderPulse}`} className="resource-v3-table-wrap quality order-updated"><table className="resource-v3-table"><thead><tr>
        {layout.visibleKeys.map((key) => renderHeader(key, qualitySort, (field) => changeSort(setQualitySort, field), qualitySortField))}
      </tr></thead><tbody>{loadingWork ? <ResourceSkeleton columns={layout.visibleKeys.length} /> : visibleQualityRows.length ? visibleQualityRows.map((row) => <QualityGroupRow key={rowKey(row)} canEdit={canEdit} group={row} visibleKeys={layout.visibleKeys} saving={savingKeys.has(rowKey(row))} fieldError={rowErrors[rowKey(row)]} onFieldError={(message) => setRowErrors((current) => ({ ...current, [rowKey(row)]: message }))} onSave={saveQualityGroup} />) : <tr><td colSpan={layout.visibleKeys.length} className="resource-empty">За выбранный период оценок подрядчиков нет.</td></tr>}</tbody></table></div>}
      {activeTab === 'quality' && <Pagination page={qualityPage} total={qualityRows.length} pageSize={pageSize} onChange={setQualityPage} onPageSizeChange={setPageSize} />}
    </section>
    <Dialog open={Boolean(selectedWork)} onClose={() => setSelectedWork(null)} modalClassName="resource-work-dialog" title="Работа с проблемой">
      {selectedWork && <div className="resource-work-side"><p><strong>{selectedWork.contractor}</strong> · {selectedWork.work_type}</p><p>{selectedWork.object_name} · {formatDate(selectedWork.report_date)}</p><dl><dt>План / факт</dt><dd>{selectedWork.plan_people ?? '—'} / {selectedWork.actual_people ?? '—'}</dd><dt>Причина</dt><dd>{selectedWork.cause || 'Не указана'}</dd><dt>Решение РП</dt><dd>{selectedWork.decision || 'Не указано'}</dd></dl><label><span>Комментарий департамента</span><textarea disabled={!canEdit} value={comments[rowKey(selectedWork)] || ''} onChange={(event) => setComments((current) => ({ ...current, [rowKey(selectedWork)]: event.target.value }))} onBlur={() => canEdit && saveComment(selectedWork)} /></label><label className="status-toggle"><input type="checkbox" disabled={!canEdit} checked={Boolean(qualityWork[rowKey(selectedWork)]?.isResolved)} onChange={(event) => toggleRowResolved(selectedWork, event.target.checked)} /><span>Проблема отработана</span></label>{qualityWork[rowKey(selectedWork)]?.updatedAt && <small>Последнее изменение: {new Date(`${qualityWork[rowKey(selectedWork)].updatedAt}Z`).toLocaleString('ru-RU')}</small>}</div>}
    </Dialog>
  </div>;
}

function QualityGroupRow({ group, visibleKeys, saving, canEdit, fieldError, onFieldError, onSave }) {
  const [comment, setComment] = useState(group.comment);
  const [resolved, setResolved] = useState(group.resolved);
  useEffect(() => { setComment(group.comment); setResolved(group.resolved); }, [group.comment, group.resolved]);
  const persist = async (nextComment = comment, nextResolved = resolved) => {
    if (nextResolved && !String(nextComment || '').trim()) {
      onFieldError('Опишите, что сделано с подрядчиком, прежде чем отмечать работу отработанной.');
      return false;
    }
    if (String(nextComment || '').trim() === String(group.comment || '').trim() && nextResolved === group.resolved) return true;
    return onSave(group, nextComment, nextResolved);
  };
  const cells = {
    date: <td key="date" className="nowrap sticky-col" style={stickyStyle('date', visibleKeys)}>{formatDate(group.report_date)}</td>,
    contractor: <td key="contractor" className="sticky-col" style={stickyStyle('contractor', visibleKeys)}><strong>{group.name}</strong></td>,
    object: <td key="object" className="sticky-col" style={stickyStyle('object', visibleKeys)}>{group.object_name}</td>,
    work: <td key="work">{group.worksLabel}{group.detail ? <small>{group.detail}</small> : null}</td>,
    quality: <td key="quality"><QualityValue row={group} /></td>,
    plan: <td key="plan" className="number">{group.plan}</td>,
    deviation: <td key="deviation" className={`number ${group.deviation < 0 ? 'value-negative' : 'value-positive'}`}>{group.deviation > 0 ? '+' : ''}{group.deviation}</td>,
    decision: <td key="decision"><span className={`resource-decision-badge ${decisionClass(group.decision)}`}>{group.decision}</span></td>,
    comment: <td key="comment" className="resource-comment-cell"><textarea rows="2" value={comment} disabled={!canEdit || saving} maxLength={2000} placeholder={canEdit ? 'Претензия, уведомление, переговоры, замена…' : 'Только для просмотра'} onChange={(event) => { setComment(event.target.value); onFieldError(''); }} onBlur={() => canEdit && persist()} />{fieldError && <small className="resource-field-error">{fieldError}</small>}{saving && <small>сохранение…</small>}</td>,
    status: <td key="status"><label className="resource-check"><input type="checkbox" checked={resolved} disabled={!canEdit || saving} onChange={async (event) => { const previous = resolved; const next = event.target.checked; setResolved(next); if (!await persist(comment, next)) setResolved(previous); }} /><span>✓</span></label></td>,
  };
  return <tr className={resolved ? 'resolved' : ''}>{visibleKeys.map((key) => cells[key])}</tr>;
}
