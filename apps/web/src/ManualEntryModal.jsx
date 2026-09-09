import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import Dialog from './Dialog.jsx';
import { ClearableInput, ComboBox, NonNegativeIntegerInput, ReplaceOnFocusInput } from './UiControls.jsx';

const QUALITY_KEYS = ['workQualityFact', 'disciplineFact', 'peopleCountFact', 'productivityFact', 'cleanlinessFact'];
const CONTRACTOR_FAULT = 'фронт и материалы есть, нет людей';
const OWN = 'собственные силы';
const norm = (value) => String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
const identity = (row) => `${norm(row.contractor)}\u001f${norm(row.workType)}`;
const filledQuality = (row = {}) => QUALITY_KEYS.filter((key) => String(row[key] || '').trim()).length;
const isOwn = (row) => norm(row.workType) === OWN || norm(row.contractor) === OWN;
const draftKey = (userId, objectId, reportDate) => `people-report-manual-draft:${userId || 'unknown'}:${objectId}:${reportDate}`;

export function isFriday(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(`${value}T00:00:00Z`).getUTCDay() === 5;
}

export function liveErrorsFor(rows, reportDate) {
  return rows.flatMap((row, index) => {
    const errors = [];
    const rowNumber = index + 1;
    if (!String(row.workType || '').trim()) errors.push({ row: rowNumber, field: 'workType', message: 'Укажите вид работы.' });
    if (!String(row.contractor || '').trim()) errors.push({ row: rowNumber, field: 'contractor', message: 'Укажите подрядчика.' });
    if (row.actualPeople === null || row.actualPeople === '') errors.push({ row: rowNumber, field: 'actualPeople', message: 'Не внесён факт за день.' });
    if (row.actualPeople !== null && row.actualPeople !== '' && Number(row.actualPeople) < Number(row.planPeople || 0) && !isOwn(row) && !String(row.cause || '').trim()) {
      errors.push({ row: rowNumber, field: 'cause', message: 'Укажите причину отклонения.' });
    }
    if (norm(row.cause) === CONTRACTOR_FAULT && !String(row.decision || '').trim()) errors.push({ row: rowNumber, field: 'decision', message: 'Для этой причины необходимо решение.' });
    if (isFriday(reportDate) && Number(row.actualPeople) > 0 && row.contractor && !isOwn(row) && filledQuality(row) < 5) errors.push({ row: rowNumber, field: 'quality', message: `Заполните оценку: ${filledQuality(row)} из 5.` });
    return errors;
  });
}

function emptyRow(row = {}) {
  const ownInContractor = norm(row.contractor) === OWN;
  const ownInWork = norm(row.workType) === OWN;
  const worker = ownInContractor ? row.workType : String(row.contractor || '').trim() || (ownInWork ? row.detail : '');
  return { clientKey: row.clientKey || crypto.randomUUID(), id: row.id ?? null,
    workType: ownInContractor || ownInWork ? 'Собственные силы' : row.workType || '',
    detail: ownInContractor || (ownInWork && !String(row.contractor || '').trim()) ? '' : row.detail || '',
    contractor: ownInContractor || ownInWork ? worker : row.contractor || '',
    planPeople: row.planPeople ?? 0, actualPeople: row.actualPeople ?? '', cause: row.cause || '', decision: row.decision || '',
    ...Object.fromEntries(QUALITY_KEYS.map((key) => [key, row[key] || ''])) };
}

function fmtDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'long' });
}

function Check({ checked, onChange, label }) {
  return <label className="v4-check" aria-label={label}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></span></label>;
}

export default function ManualEntryModal({ open, readOnly = false, userId, onClose, objects, initialObjectId, initialReportDate, notify, onSaved, onDashboard, onChangeContext }) {
  const [objectId, setObjectId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [rows, setRows] = useState([]);
  const [catalogs, setCatalogs] = useState({ workTypes: [], causes: [], decisions: [], contractors: [], qualityCriteria: [], weeklyContractors: [] });
  const [weeklyQuality, setWeeklyQuality] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: '', direction: 1 });
  const [selected, setSelected] = useState(new Set());
  const [qualityOpen, setQualityOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedPlanRowIds, setRemovedPlanRowIds] = useState([]);
  const [draftTime, setDraftTime] = useState('');
  const [validationOpen, setValidationOpen] = useState(false);
  const [lockConflict, setLockConflict] = useState(null);
  const [forcedReadOnly, setForcedReadOnly] = useState(false);
  const baseline = useRef('');

  const object = objects.find((item) => String(item.id) === String(objectId));
  const friday = isFriday(reportDate);
  const snapshot = (nextRows = rows, removed = removedPlanRowIds, quality = weeklyQuality) => JSON.stringify({ rows: nextRows, removed, quality });
  const errors = useMemo(() => liveErrorsFor(rows, reportDate).filter((item) => item.field !== 'quality'), [rows, reportDate]);
  const errorFor = (index, field) => errors.find((item) => item.row === index + 1 && item.field === field);
  const effectiveReadOnly = readOnly || forcedReadOnly;

  useEffect(() => {
    if (!open) return;
    const available = objects.filter((item) => item.id);
    setObjectId(initialObjectId !== 'all' && available.some((item) => String(item.id) === String(initialObjectId)) ? String(initialObjectId) : String(available[0]?.id || ''));
    setReportDate(initialReportDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    setQuery(''); setFilter('all'); setSort({ key: '', direction: 1 }); setSelected(new Set());
  }, [open, initialObjectId, initialReportDate, objects]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open || !objectId || !reportDate) return;
    let active = true; setLoading(true);
    api(`/api/manual/form?objectId=${encodeURIComponent(objectId)}&reportDate=${encodeURIComponent(reportDate)}`).then((data) => {
      if (!active) return;
      let nextRows = data.rows.map(emptyRow); let nextRemoved = []; let nextQuality = {};
      data.weeklyContractors.forEach((item) => { nextQuality[identity(item)] = { ...item }; });
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey(userId, objectId, reportDate)) || 'null');
        if (draft?.reportDate === reportDate && draft.rows?.length) { nextRows = draft.rows.map(emptyRow); nextRemoved = draft.removedPlanRowIds || []; nextQuality = draft.weeklyQuality || nextQuality; notify('Черновик восстановлен'); }
      } catch { localStorage.removeItem(draftKey(userId, objectId, reportDate)); }
      setCatalogs(data); setRows(nextRows); setRemovedPlanRowIds(nextRemoved); setWeeklyQuality(nextQuality); baseline.current = snapshot(nextRows, nextRemoved, nextQuality);
    }).catch((error) => notify(error.message, 'error')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, objectId, reportDate]);

  useEffect(() => {
    if (!open || effectiveReadOnly || !objectId || !reportDate) return undefined;
    const refresh = () => api('/api/manual/lock', { method: 'POST', body: JSON.stringify({ objectId: Number(objectId), reportDate }) })
      .catch((error) => error.status === 409 ? setLockConflict({ author: error.details?.[0]?.author || 'другой пользователь', message: error.message }) : notify(error.message, 'error', refresh));
    const interval = window.setInterval(refresh, 4 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [open, effectiveReadOnly, objectId, reportDate]);

  const weekItems = useMemo(() => {
    const map = new Map(catalogs.weeklyContractors.map((item) => [identity(item), item]));
    rows.filter((row) => Number(row.actualPeople) > 0 && row.contractor && row.workType && !isOwn(row)).forEach((row) => {
      const key = identity(row); if (!map.has(key)) map.set(key, { contractor: row.contractor, workType: row.workType, firstDate: reportDate, lastDate: reportDate });
    });
    return [...map.values()];
  }, [catalogs.weeklyContractors, rows, reportDate]);

  const ratedCount = weekItems.filter((item) => filledQuality(weeklyQuality[identity(item)]) === 5).length;
  const missingQuality = friday ? weekItems.filter((item) => filledQuality(weeklyQuality[identity(item)]) < 5) : [];
  const visible = useMemo(() => rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    if (query && !`${row.workType} ${row.detail} ${row.contractor}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))) return false;
    if (filter === 'empty' && row.actualPeople !== '') return false;
    if (filter === 'dev' && (row.actualPeople === '' || Number(row.actualPeople) === Number(row.planPeople || 0))) return false;
    return true;
  }).sort((a, b) => {
    const group = Number(isOwn(b.row)) - Number(isOwn(a.row)); if (group) return group;
    if (!sort.key) return a.index - b.index;
    const av = sort.key === 'deviation' ? Number(a.row.actualPeople || 0) - Number(a.row.planPeople || 0) : a.row[sort.key];
    const bv = sort.key === 'deviation' ? Number(b.row.actualPeople || 0) - Number(b.row.planPeople || 0) : b.row[sort.key];
    return (typeof av === 'number' ? av - bv : String(av || '').localeCompare(String(bv || ''), 'ru')) * sort.direction;
  }), [rows, query, filter, sort]);

  const totals = rows.reduce((result, row) => ({ plan: result.plan + Number(row.planPeople || 0), fact: result.fact + Number(row.actualPeople || 0), filled: result.filled + (row.actualPeople === '' ? 0 : 1) }), { plan: 0, fact: 0, filled: 0 });
  const deviation = totals.fact - totals.plan; const percent = totals.plan ? Math.round(totals.fact / totals.plan * 100) : 0;
  const touchDraft = (nextRows, nextQuality = weeklyQuality) => {
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); setDraftTime(time);
    localStorage.setItem(draftKey(userId, objectId, reportDate), JSON.stringify({ reportDate, rows: nextRows, removedPlanRowIds, weeklyQuality: nextQuality }));
  };
  const updateRow = (index, field, value) => setRows((current) => { const next = current.map((row, i) => i === index ? { ...row, [field]: value } : row); touchDraft(next); return next; });
  const addRow = () => { const next = [...rows, emptyRow()]; setRows(next); touchDraft(next); };
  const removeIndexes = (indexes) => {
    const ids = rows.filter((_, index) => indexes.has(index)).map((row) => row.id).filter(Boolean);
    setRemovedPlanRowIds((current) => [...current, ...ids]); const next = rows.filter((_, index) => !indexes.has(index)); setRows(next); setSelected(new Set()); touchDraft(next); notify(`Удалено строк: ${indexes.size}`);
  };
  const changeSort = (key) => setSort((current) => current.key === key ? { key, direction: -current.direction } : { key, direction: 1 });
  const close = () => {
    if (snapshot() === baseline.current) return onClose();
    setConfirm({ title: 'Закрыть без сохранения?', text: `Заполнено ${totals.filled} строк. Изменения останутся в черновике.`, action: () => onClose() });
  };
  const save = async () => {
    if (errors.length) { setValidationOpen(true); notify(`В форме ошибок: ${errors.length}`, 'error'); return; }
    if (missingQuality.length) { setConfirm({ title: 'Нужна оценка за неделю', text: 'Отчёт за пятницу закрывает неделю. Заполните оценки всех подрядчиков.', action: () => setQualityOpen(true), actionText: 'Оценить' }); return; }
    setSaving(true);
    try {
      const ratings = weekItems.map((item) => ({ ...item, ...weeklyQuality[identity(item)] }));
      const ratedRows = rows.map((row) => ({ ...row, ...(weeklyQuality[identity(row)] || {}) }));
      const result = await api('/api/manual/reports', { method: 'POST', body: JSON.stringify({ objectId: Number(objectId), reportDate, rows: ratedRows, weeklyQuality: ratings, removedPlanRowIds }) });
      localStorage.removeItem(draftKey(userId, objectId, reportDate)); baseline.current = snapshot(ratedRows, [], weeklyQuality); await onSaved?.(result); notify(`Отчёт сохранён: план ${totals.plan}, факт ${totals.fact}, выполнение ${percent}%`);
      onDashboard?.({ ...result, objectId, reportDate, contractors: [...new Set(rows.map((row) => row.contractor).filter(Boolean))], workTypes: [...new Set(rows.map((row) => row.workType).filter(Boolean))] });
    } catch (error) { if (error.status === 409 || ['REPORT_LOCKED', 'LOCK_LOST'].includes(error.code)) setLockConflict({ author: error.details?.[0]?.author || 'другой пользователь', message: error.message }); else notify(error.message, 'error', save); } finally { setSaving(false); }
  };

  if (!open) return null;
  const columns = [['workType', 'Вид работы'], ['detail', 'Детализация'], ['contractor', 'Подрядчик'], ['planPeople', 'План'], ['actualPeople', 'Факт'], ['deviation', 'Откл.'], ['cause', 'Причина'], ['decision', 'Решение']];
  const askBulkRemove = () => setConfirm({
    title: `Удалить строк: ${selected.size}?`,
    text: 'Строки исчезнут из сегодняшнего отчёта.',
    actionText: 'Удалить',
    action: () => removeIndexes(new Set(rows.map((_, index) => index).filter((index) => selected.has(rows[index].clientKey)))),
  });
  let lastGroup = '';
  return <>
    <div className="v4-entry-overlay" role="dialog" aria-modal="true" aria-label="Внести данные">
      <section className={`v4-sheet ${effectiveReadOnly ? 'is-readonly' : ''}`}>
        <header className="v4-top"><div className="v4-title">Внести <span>данные</span></div><div className="v4-context"><b>{object?.name || 'Объект'}</b><i /><b>{fmtDate(reportDate)}</b><button onClick={() => onChangeContext ? onChangeContext() : close()}>изменить</button></div><div className="v4-top-right"><div className="v4-progress"><div><span>Заполнено</span><span>{totals.filled} из {rows.length}</span></div><i><b className={totals.filled === rows.length && rows.length ? 'full' : ''} style={{ width: `${rows.length ? totals.filled / rows.length * 100 : 0}%` }} /></i></div><span className="v4-draft">{draftTime ? `черновик ${draftTime}` : 'черновик'}</span></div></header>
        <div className="v4-tools"><ClearableInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по виду работ или подрядчику" /><div className="v4-segments">{[['all', 'Все'], ['empty', 'Незаполненные'], ['dev', 'С отклонением']].map(([key, label]) => <button className={filter === key ? 'on' : ''} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div></div>
        <div className={`v4-bulk ${selected.size ? 'show' : ''}`}><b>Выбрано строк: {selected.size}</b><button onClick={() => setSelected(new Set())}>Снять выделение</button><button className="danger" onClick={askBulkRemove}>Удалить выбранные</button></div>
        <div className="v4-scroll"><table className="v4-table"><thead><tr><th><Check label="Выбрать все" checked={visible.length > 0 && visible.every(({ row }) => selected.has(row.clientKey))} onChange={(checked) => setSelected(checked ? new Set(visible.map(({ row }) => row.clientKey)) : new Set())} /></th>{columns.map(([key, label]) => <th key={key} onClick={() => changeSort(key)}>{label}{sort.key === key && <small>{sort.direction > 0 ? '▲' : '▼'}</small>}</th>)}<th /></tr></thead><tbody>
          {visible.map(({ row, index }) => { const group = isOwn(row) ? 'Собственные силы' : 'Подрядчики'; const showGroup = group !== lastGroup; lastGroup = group; const groupRows = rows.filter((item) => (isOwn(item) ? 'Собственные силы' : 'Подрядчики') === group); const dev = row.actualPeople === '' ? null : Number(row.actualPeople) - Number(row.planPeople || 0); return <FragmentRow key={row.clientKey} group={showGroup ? group : ''} summary={`${groupRows.filter((item) => item.actualPeople !== '').length} из ${groupRows.length} · план ${groupRows.reduce((s, item) => s + Number(item.planPeople || 0), 0)} · факт ${groupRows.reduce((s, item) => s + Number(item.actualPeople || 0), 0)}`}>
            <tr className={selected.has(row.clientKey) ? 'picked' : ''}><td className="v4-rowno"><Check label={`Выбрать строку ${index + 1}`} checked={selected.has(row.clientKey)} onChange={(checked) => setSelected((current) => { const next = new Set(current); checked ? next.add(row.clientKey) : next.delete(row.clientKey); return next; })} /><span>{index + 1}</span></td>
              <Cell error={errorFor(index, 'workType')}><ComboBox options={catalogs.workTypes} value={row.workType} allowCustom onChange={(value) => updateRow(index, 'workType', value)} placeholder="Вид работы" /></Cell>
              <td><ReplaceOnFocusInput value={row.detail} onChange={(value) => updateRow(index, 'detail', value)} maxLength={30} placeholder="До 30 символов" /></td>
              <Cell error={errorFor(index, 'contractor')}><ComboBox options={catalogs.contractors} value={row.contractor} allowCustom onChange={(value) => updateRow(index, 'contractor', value)} placeholder="Подрядчик" /></Cell>
              <td><NonNegativeIntegerInput value={row.planPeople} onChange={(value) => updateRow(index, 'planPeople', value)} /></td>
              <Cell error={errorFor(index, 'actualPeople')} warning={dev > 0 ? 'Факт больше плана — проверьте.' : ''}><NonNegativeIntegerInput value={row.actualPeople} onChange={(value) => updateRow(index, 'actualPeople', value)} placeholder="—" /></Cell>
              <td><b className={`v4-dev ${dev < 0 ? 'neg' : dev > 0 ? 'pos' : ''}`}>{dev === null ? '—' : `${dev > 0 ? '+' : ''}${dev}`}</b></td>
              <Cell error={errorFor(index, 'cause')}><ComboBox options={catalogs.causes} value={row.cause} allowCustom onChange={(value) => updateRow(index, 'cause', value)} placeholder={dev < 0 && !isOwn(row) ? 'обязательно' : 'при необходимости'} /></Cell>
              <Cell error={errorFor(index, 'decision')}><ComboBox options={catalogs.decisions} value={row.decision} allowCustom onChange={(value) => updateRow(index, 'decision', value)} placeholder={norm(row.cause) === CONTRACTOR_FAULT ? 'обязательно' : 'при необходимости'} /></Cell>
              <td><button className="v4-remove" onClick={() => setConfirm({ title: 'Убрать строку?', text: `${row.workType || 'Без названия'} — ${row.contractor || 'без подрядчика'} исчезнет из сегодняшнего отчёта.`, actionText: 'Убрать', action: () => removeIndexes(new Set([index])) })}>×</button></td></tr>
          </FragmentRow>; })}
          {!visible.length && <tr><td colSpan="10" className="v4-empty">Ничего не найдено</td></tr>}<tr className="v4-add"><td colSpan="10"><button onClick={addRow}><span>+</span>Добавить строку</button></td></tr>
        </tbody></table></div>
        <footer className="v4-foot"><div className="v4-totals"><span><b>{totals.plan}</b>план</span><span><b>{totals.fact}</b>факт</span><span><b className={deviation < 0 ? 'neg' : deviation > 0 ? 'pos' : ''}>{deviation > 0 ? '+' : ''}{deviation}</b>откл.</span><span><b className={percent < 80 ? 'neg' : percent < 100 ? 'warn' : 'pos'}>{percent}%</b>выполнение</span></div>{friday && weekItems.length > 0 && <button className={`v4-status ${missingQuality.length ? 'warn' : 'ok'}`} onClick={() => setQualityOpen(true)}>{missingQuality.length ? `Пятница: не оценено подрядчиков — ${missingQuality.length}` : `Оценено подрядчиков — ${ratedCount}`} <u>{effectiveReadOnly ? 'посмотреть' : missingQuality.length ? 'оценить' : 'изменить'}</u></button>}{!errors.length && rows.length > 0 && (!friday || !weekItems.length) && <span className="v4-status ok">{effectiveReadOnly ? 'Только просмотр' : draftTime ? `Черновик сохранён в ${draftTime}` : 'Готово к сохранению'}</span>}<div className="v4-actions"><button className="flat" onClick={close}>{effectiveReadOnly ? 'Закрыть' : 'Отмена'}</button>{!effectiveReadOnly && <button disabled={saving || loading || !rows.length} onClick={save}>{saving ? 'Сохранение…' : 'Сохранить отчёт'}</button>}</div></footer>
      </section>
    </div>
    {qualityOpen && <QualityMatrix items={weekItems} quality={weeklyQuality} criteria={catalogs.qualityCriteria}
      onSave={(nextQuality) => { setWeeklyQuality(nextQuality); touchDraft(rows, nextQuality); setQualityOpen(false); }}
      onClose={() => setQualityOpen(false)} readOnly={effectiveReadOnly} />}
    {confirm && <Dialog open onClose={() => setConfirm(null)} modalClassName="confirm-dialog" title={confirm.title} footer={<><button className="manual-cancel-btn" onClick={() => setConfirm(null)}>Остаться</button><button className={confirm.actionText === 'Оценить' ? 'manual-save-btn' : 'danger-action'} onClick={() => { const action = confirm.action; setConfirm(null); action?.(); }}>{confirm.actionText || 'Закрыть'}</button></>}><p>{confirm.text}</p></Dialog>}
    <Dialog open={validationOpen} onClose={() => setValidationOpen(false)} modalClassName="confirm-dialog" title="Исправьте ошибки формы"><div className="validation-summary">{errors.map((error, index) => <button key={`${error.row}-${error.field}-${index}`} onClick={() => { setValidationOpen(false); const row = [...document.querySelectorAll('.v4-table tbody tr')].filter((item) => !item.classList.contains('v4-group') && !item.classList.contains('v4-add'))[error.row - 1]; row?.scrollIntoView({ behavior: 'smooth', block: 'center' }); row?.querySelector('input,button')?.focus(); }}>Строка {error.row}: {error.message}</button>)}</div></Dialog>
    <Dialog open={Boolean(lockConflict)} onClose={() => setLockConflict(null)} modalClassName="confirm-dialog" title="Отчёт редактирует коллега" footer={<><button className="manual-cancel-btn" onClick={() => setLockConflict(null)}>Закрыть</button><button className="manual-save-btn" onClick={() => { setForcedReadOnly(true); setLockConflict(null); }}>Открыть для просмотра</button></>}><p>{lockConflict?.message}</p><p>Автор блокировки: <strong>{lockConflict?.author}</strong></p></Dialog>
  </>;
}

function FragmentRow({ group, summary, children }) { return <>{group && <tr className="v4-group"><td colSpan="10">{group}<span>{summary}</span></td></tr>}{children}</>; }
function Cell({ error, warning, children }) { return <td className={error ? 'v4-error' : warning ? 'v4-warning' : ''}>{children}{(error || warning) && <small className="v4-tip">{error?.message || warning}</small>}</td>; }

function QualityMatrix({ items, quality, criteria, onSave, onClose, readOnly }) {
  const [draft, setDraft] = useState(() => structuredClone(quality));
  const draftRatedCount = items.filter((item) => filledQuality(draft[identity(item)]) === 5).length;
  const setDraftRating = (item, key, value) => setDraft((current) => {
    const id = identity(item);
    return { ...current, [id]: { ...item, ...current[id], [key]: current[id]?.[key] === value ? '' : value } };
  });
  return <div className="v4-quality-overlay" role="dialog" aria-modal="true"><section className="v4-quality"><header><div><h2>Оценка <span>подрядчиков</span> за неделю</h2><p>{readOnly ? 'Оценка доступна только для просмотра' : 'Выберите формулировку в каждом блоке, балл считается автоматически'}</p></div></header><div className="v4-quality-scroll"><table><thead><tr><th>Категории и формулировка</th>{items.map((item) => <th key={identity(item)}>{item.contractor}<small>{item.workType}</small></th>)}</tr></thead><tbody>{criteria.map((criterion) => <QualityCriterion key={criterion.key} criterion={criterion} items={items} quality={draft} onSet={setDraftRating} readOnly={readOnly} />)}</tbody></table></div><footer><span className={`v4-status ${draftRatedCount === items.length ? 'ok' : 'warn'}`}>{draftRatedCount === items.length ? `Отмечены все ${items.length} подрядчиков` : `Отмечено ${draftRatedCount} из ${items.length}`}</span><div><button className="flat" onClick={onClose}>{readOnly ? 'Закрыть' : 'Отмена'}</button>{!readOnly && <button disabled={draftRatedCount !== items.length} onClick={() => onSave(draft)}>Сохранить оценки</button>}</div></footer></section></div>;
}
function QualityCriterion({ criterion, items, quality, onSet, readOnly }) {
  const missing = items.filter((item) => !quality[identity(item)]?.[criterion.key]).length;
  return <><tr className={missing ? 'criterion missing' : 'criterion'}><td colSpan={items.length + 1}>{criterion.title}{missing ? ` — не отмечено у ${missing} из ${items.length}` : ''}</td></tr>{criterion.options.map((option, score) => <tr className="option" key={option}><td>{option}</td>{items.map((item) => { const on = quality[identity(item)]?.[criterion.key] === option; return <td className={!quality[identity(item)]?.[criterion.key] ? 'missing-cell' : ''} key={identity(item)}><button disabled={readOnly} className={on ? 'on' : ''} onClick={() => onSet(item, criterion.key, option)} aria-label={`${score}: ${option}`}><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></button></td>; })}</tr>)}</>;
}
