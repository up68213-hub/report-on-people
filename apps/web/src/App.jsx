import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import ManualEntryModal from './ManualEntryModal.jsx';
import EntrySetupModal from './EntrySetupModal.jsx';
import ResourceDepartmentPage from './ResourceDepartmentPage.jsx';
import AdminPage from './AdminPage.jsx';
import { ClearableInput, ComboBox, DateRangeField } from './UiControls.jsx';
import Dialog from './Dialog.jsx';
import { api, setDevUserId } from './api.js';
import {
  CRITERIA, aggregateTable, calculateKpis, decisionMeta,
  isContractorFault, isOwnForces, qualityGrade,
} from './dashboard.js';

const roleNames = {
  administrator: 'Администратор',
  project_manager: 'Руководитель проекта',
  resource_manager: 'Сотрудник Деп. ресурсов',
  observer: 'Наблюдатель',
};

function Icon({ name, className = '' }) {
  let content = null;
  if (name === 'download') content = <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>;
  if (name === 'filter') content = <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />;
  if (name === 'reset') content = <><path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" /><line x1="3" y1="21" x2="21" y2="3" /></>;
  if (name === 'summary') content = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>;
  if (name === 'refresh') content = <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>;
  if (name === 'history') content = <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /><path d="M4.5 5.5 2.5 5.5 2.5 3.5" /></>;
  if (name === 'admin') content = <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20v-2.2A4.8 4.8 0 0 1 10.3 13h3.4a4.8 4.8 0 0 1 4.8 4.8V20" /><path d="M19 9.5v4M17 11.5h4" /></>;
  if (name === 'edit') content = <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>;
  if (name === 'close') content = <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>;
  if (name === 'sun') content = <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M2.5 12h2M19.5 12h2M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5" /></>;
  if (name === 'moon') content = <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
  return <svg className={className} aria-hidden="true" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">{content}</svg>;
}

function Kpis({ records }) {
  const kpi = calculateKpis(records);
  const percentClass = kpi.percent < 80 ? 'roi-bad' : kpi.percent < 95 ? 'roi-mid' : 'roi-good';
  const circumference = 2 * Math.PI * 28;
  const clamped = Math.max(0, Math.min(100, kpi.percent));
  const color = clamped >= 95 ? '#9DB984' : clamped >= 80 ? '#EECB95' : '#D88188';
  return (
    <div className="kpi-row">
      <div className="kpi" data-metric="plan">
        <div className="kpi-label">План <span className="kpi-tag">чел.</span></div>
        <div className="kpi-main kpi-main-center"><div className="kpi-num">{kpi.plan.toFixed(0)}</div></div>
      </div>
      <div className="kpi" data-metric="fact">
        <div className="kpi-label">Факт <span className="kpi-tag">чел.</span></div>
        <div className="kpi-main kpi-main-center"><div className="kpi-num">{kpi.fact.toFixed(0)}</div></div>
      </div>
      <div className={`kpi ${percentClass}`} data-metric="percent">
        <div className="kpi-label">Выполнение <span className="kpi-tag">%</span></div>
        <div className="kpi-main kpi-main-percent">
          <div className="kpi-num">{kpi.percent.toFixed(1)}%</div>
          <div className="kpi-donut-wrap"><div className="kpi-donut">
            <svg viewBox="0 0 72 72"><g transform="rotate(-90 36 36)">
              <circle className="donut-bg" cx="36" cy="36" r="28" />
              <circle className="donut-segment" cx="36" cy="36" r="28" stroke={color}
                strokeDasharray={`${circumference * clamped / 100} ${circumference * (1 - clamped / 100)}`} />
            </g></svg>
          </div></div>
        </div>
      </div>
      <div className="kpi" data-metric="quality">
        <div className="kpi-label">Сред. качество <span className="kpi-tag">балл</span></div>
        <div className="kpi-main kpi-main-center"><div className="kpi-num">{kpi.quality.toFixed(1)}</div></div>
      </div>
    </div>
  );
}

function DetailTable({ records, filters, toggleFilter, onCriteria }) {
  const [sort, setSort] = useState({ field: null, asc: true });
  const groups = useMemo(() => {
    const result = aggregateTable(records);
    result.sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
    if (!sort.field) return result;
    const direction = sort.asc ? 1 : -1;
    return result.sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      const values = {
        work: [a.work, b.work], contractor: [a.contractor, b.contractor],
        quality: [a.quality ?? -1, b.quality ?? -1], decision: [decisionMeta(a.decision).rank, decisionMeta(b.decision).rank],
        plan: [a.plan, b.plan], deviation: [a.deviation, b.deviation],
        reasons: [[...a.reasons].join(', '), [...b.reasons].join(', ')],
      }[sort.field];
      return typeof values[0] === 'string'
        ? values[0].localeCompare(values[1], 'ru') * direction
        : (values[0] - values[1]) * direction;
    });
  }, [records, sort]);
  const maxPlan = Math.max(1, ...groups.map((g) => g.plan));
  const maxDeviation = Math.max(1, ...groups.map((g) => Math.abs(g.deviation)));
  const changeSort = (field) => setSort((old) => ({ field, asc: old.field === field ? !old.asc : true }));
  const header = (field, label) => (
    <th onClick={() => changeSort(field)}>{label} <span className="sort-icon">{sort.field === field ? (sort.asc ? '▲' : '▼') : ''}</span></th>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Детализация <span className="panel-unit">чел.</span></div>
        <div className="panel-sub corner">план / отклонение</div>
      </div>
      <div className="panel-body table-panel-body">
        <div className="table-wrap">
          <table id="detail-table">
            <thead><tr>
              {header('work', 'Вид работы')}{header('contractor', 'Подрядчик')}
              {header('quality', 'Качество')}{header('decision', 'Решение')}
              {header('plan', 'План')}{header('deviation', 'Отклонение')}{header('reasons', 'Причина')}
            </tr></thead>
            <tbody>
              {!groups.length && <tr><td colSpan="7" className="empty-cell">Нет данных за выбранную дату</td></tr>}
              {groups.map((group, index) => {
                const grade = qualityGrade(group.quality);
                const hasCriteria = group.rows.some((row) => CRITERIA.some(([, key]) => row[key]));
                const deviationClass = group.deviation > 0 ? 'pos' : group.deviation < 0 ? 'neg' : 'zero';
                return (
                  <tr key={`${group.work}-${group.contractor}`} className={`${group.isOwn ? 'own-forces-row' : ''} ${group.isOwn && !groups[index + 1]?.isOwn ? 'own-forces-end' : ''}`}>
                    <td className={filters.workTypes.includes(group.work) ? 'cell-filter filter-active' : 'cell-filter'}
                      onClick={() => toggleFilter('workTypes', group.work)}>{group.work}</td>
                    <td className={group.isOwn ? 'own-cell' : filters.contractors.includes(group.contractor) ? 'cell-filter filter-active' : 'cell-filter'}
                      onClick={() => !group.isOwn && toggleFilter('contractors', group.contractor)}>{group.contractor}</td>
                    <td>{grade ? <button className={`quality-badge ${grade.cls} ${hasCriteria ? 'clickable' : ''}`}
                      onClick={() => hasCriteria && onCriteria(group)} title={grade.level}>{group.quality.toFixed(1)}</button> : '—'}</td>
                    <td>{group.decision ? <button className={`decision-badge ${decisionMeta(group.decision).cls} ${filters.decisions.includes(group.decision) ? 'filter-active' : ''}`}
                      onClick={() => toggleFilter('decisions', group.decision)}>{group.decision}</button> : '—'}</td>
                    <td className="bar-cell"><div className="bar-container">
                      <span className="bar-value">{group.plan.toFixed(0)}</span>
                      <div className="bar-bg"><div className="bar-fill" style={{ width: `${group.plan / maxPlan * 100}%` }} /></div>
                    </div></td>
                    <td className="bar-cell"><div className="deviation-container">
                      <span className={`deviation-value ${deviationClass}`}>{group.deviation > 0 ? '+' : ''}{group.deviation.toFixed(0)}</span>
                      <div className="deviation-bar"><div className={group.deviation < 0 ? 'dev-neg' : 'dev-pos'} style={{ width: `${Math.abs(group.deviation) / maxDeviation * 50}%`, [group.deviation < 0 ? 'right' : 'left']: '50%' }} /><div className="dev-zero" /></div>
                    </div></td>
                    <td><div className="reason-texts">{[...group.reasons].map((reason) => <button key={reason}
                      className={filters.reasons.includes(reason) ? 'filter-active' : ''}
                      onClick={() => toggleFilter('reasons', reason)}>{reason}</button>)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Ranking({ records, type, filters, toggleFilter }) {
  const [anti, setAnti] = useState(true);
  const [limit, setLimit] = useState(10);
  const rows = useMemo(() => {
    const map = new Map();
    for (const row of records) {
      if (!row.contractor || isOwnForces(row)) continue;
      if (type === 'people') {
        const deviation = Number(row.deviation || 0);
        if (anti && (deviation >= 0 || !isContractorFault(row.cause))) continue;
        map.set(row.contractor, (map.get(row.contractor) || 0) + deviation);
      } else if (row.quality_score !== null) {
        if (!map.has(row.contractor)) map.set(row.contractor, []);
        map.get(row.contractor).push(Number(row.quality_score));
      }
    }
    let values = [...map].map(([name, value]) => ({
      name,
      value: Array.isArray(value) ? value.reduce((a, b) => a + b, 0) / value.length : value,
    }));
    if (type === 'people') values = values.filter((x) => anti ? x.value < 0 : x.value >= 0);
    else values = values.filter((x) => anti ? x.value < 4 : x.value >= 4);
    values.sort((a, b) => anti ? a.value - b.value : b.value - a.value);
    return values.slice(0, limit);
  }, [records, type, anti, limit]);
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const quality = type === 'quality';
  return (
    <div className="chart-card">
      <div className="chart-title"><span>{anti ? 'АНТИРЕЙТИНГ' : 'ТОП'} {rows.length}</span> подрядчиков по {quality ? 'качеству' : 'кол-ву людей'} <span className="panel-unit">{quality ? 'балл' : 'чел.'}</span></div>
      <div className="chart-sub">{quality ? 'средняя оценка' : anti ? 'недобор по вине подрядчика' : 'отклонение (факт − план)'}</div>
      <div className="plot-container">
        <div className="top-controls">
          <span className="top-label">Топ</span>
          <input type="range" min="1" max="10" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="top-slider" />
          <span className={`top-count-badge ${anti ? 'anti-mode' : 'active'}`}>{anti ? 'АНТИРЕЙТИНГ' : 'ТОП'} {rows.length}</span>
          <span className="top-ctrl-sep" />
          <label className="anti-toggle"><input type="checkbox" checked={anti} onChange={(e) => setAnti(e.target.checked)} />
            <div className="anti-track"><div className="anti-knob" /></div><span className="anti-label">АНТИРЕЙТИНГ</span>
          </label>
        </div>
        <div className={`hbar-list ${rows.length ? '' : 'empty'}`}>
          {!rows.length && <div className="empty-message">Нет данных для отображения</div>}
          {rows.map((row) => <button key={row.name} className={`hbar-row ${filters.contractors.includes(row.name) ? 'is-selected' : ''}`}
            onClick={() => toggleFilter('contractors', row.name)}>
            <div className="hbar-name" title={row.name}>{row.name}</div>
            <div className="hbar-track"><div className={`hbar-fill ${quality ? row.value < 3.5 ? 'quality-low' : 'quality-high' : row.value < 0 ? 'deviation-neg' : 'deviation-pos'}`}
              style={{ width: `${Math.max(5, Math.abs(row.value) / max * 100)}%` }}>
              <span className="hbar-val">{!quality && row.value > 0 ? '+' : ''}{quality ? row.value.toFixed(1) : row.value.toFixed(0)}</span>
            </div></div>
          </button>)}
        </div>
      </div>
    </div>
  );
}

function FilterModal({ open, onClose, records, filters, setFilters }) {
  const [searches, setSearches] = useState({});
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (open) { setDraft(Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]]))); setSearches({}); } }, [open, filters]);
  const choices = (field) => [...new Set(records.map((row) => row[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const groups = [
    ['Подрядчики', 'contractors', 'contractor'], ['Вид работы', 'workTypes', 'work_type'],
    ['Причина', 'reasons', 'cause'], ['Решение', 'decisions', 'decision'],
  ];
  const toggleDraft = (key, value) => setDraft((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const clearDraft = () => setDraft({ contractors: [], workTypes: [], reasons: [], decisions: [] });
  const selectedCount = Object.values(draft).reduce((sum, values) => sum + values.length, 0);
  const header = <div className="report-filter-head"><div><div className="report-filter-title">ФИЛЬТРЫ <span>ДАННЫХ</span></div><div className="report-filter-subtitle">Отметьте значения — фильтры складываются между собой</div></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>;
  const footer = <><span className="report-filter-count">Выбрано значений: {selectedCount}</span><div className="report-filter-buttons"><button type="button" className="flat" onClick={clearDraft}>Очистить фильтры</button><button type="button" className="outline" onClick={onClose}>Отменить</button><button type="button" className="primary" onClick={() => { setFilters(draft); onClose(); }}>Применить</button></div></>;
  return <Dialog open={open} onClose={onClose} header={header} footer={footer} showClose={false} modalClassName="report-filter-modal" overlayClassName="report-filter-overlay" bodyClassName="report-filter-body" footerClassName="report-filter-foot">
    {groups.map(([title, key, field]) => {
      const query = searches[key] || '';
      const visibleChoices = choices(field).filter((value) => value.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')));
      const allVisibleSelected = visibleChoices.length > 0 && visibleChoices.every((value) => draft[key].includes(value));
      return <section className="report-filter-section" key={key}>
        <div className="report-filter-section-head"><span>{title}</span>{draft[key].length > 0 && <b>{draft[key].length}</b>}<button type="button" onClick={() => setDraft((current) => ({ ...current, [key]: allVisibleSelected ? current[key].filter((value) => !visibleChoices.includes(value)) : [...new Set([...current[key], ...visibleChoices])] }))}>{allVisibleSelected ? 'снять все' : 'выбрать все'}</button></div>
        <ClearableInput className="filter-list-search" value={query} onChange={(event) => setSearches((current) => ({ ...current, [key]: event.target.value }))} placeholder={`Поиск: ${title.toLocaleLowerCase('ru-RU')}`} aria-label={`Поиск по фильтру ${title}`} />
        <div className="filter-option-list">
          {visibleChoices.map((value) => <button type="button" key={value} className={draft[key].includes(value) ? 'selected' : ''} onClick={() => toggleDraft(key, value)}><span className="filter-option-check">✓</span><span>{value}</span></button>)}
          {!visibleChoices.length && <div className="filter-option-empty">Ничего не найдено</div>}
        </div>
      </section>;
    })}
  </Dialog>;
}

function CriteriaModal({ group, onClose }) {
  const hasCriteria = group?.rows.some((row) => CRITERIA.some(([, key]) => row[key]));
  return <Dialog open={Boolean(group)} onClose={onClose} title={group && <>{group.contractor} <span className="accent">{group.work}</span></>}>
    {!hasCriteria ? <div className="summary-section"><div className="summary-line neu">Критерии оценки не заполнены.</div></div>
      : group.rows.map((row) => <div className="summary-section" key={row.record_id}>
      <div className="summary-section-title">{new Date(`${row.report_date}T00:00:00`).toLocaleDateString('ru-RU')} — оценка {row.quality_score?.toFixed?.(1) ?? row.quality_score ?? '—'}</div>
      {CRITERIA.map(([label, key]) => row[key] ? <div className="crit-row" key={key}><span className="crit-name">{label}</span><span className="crit-val">{row[key]}</span></div> : null)}
      {row.decision && <div className="crit-row"><span className="crit-name">Решение РП</span><span className={`decision-badge ${decisionMeta(row.decision).cls}`}>{row.decision}</span></div>}
    </div>)}
  </Dialog>;
}

function SummaryModal({ open, onClose, records, onPng }) {
  const summaryRef = useRef(null);
  const kpi = calculateKpis(records);
  const contractors = new Map();
  for (const row of records) {
    const name = String(row.contractor || '').trim();
    if (!name || isOwnForces(row)) continue;
    if (!contractors.has(name)) contractors.set(name, { plan: 0, fact: 0, qualities: [], decisions: new Set(), rows: [] });
    const item = contractors.get(name);
    item.plan += Number(row.plan_people || 0);
    item.fact += Number(row.actual_people || 0);
    if (row.quality_score !== null && Number.isFinite(Number(row.quality_score))) item.qualities.push(Number(row.quality_score));
    if (row.decision) item.decisions.add(row.decision);
    item.rows.push(row);
  }

  const contractorRows = [...contractors].map(([name, item]) => ({
    ...item,
    name,
    deviation: item.fact - item.plan,
    quality: item.qualities.length ? item.qualities.reduce((sum, value) => sum + value, 0) / item.qualities.length : null,
    decision: [...item.decisions].sort((a, b) => decisionMeta(b).rank - decisionMeta(a).rank)[0] || '',
  }));
  const qualityRows = contractorRows.filter((item) => item.quality !== null);
  const hasQuality = records.some((row) => row.quality_score !== null && Number.isFinite(Number(row.quality_score)));
  const bestQuality = qualityRows.length ? Math.max(...qualityRows.map((item) => item.quality)) : null;
  const bestQualityNames = qualityRows.filter((item) => item.quality === bestQuality).map((item) => item.name);
  const worstDeviation = contractorRows.length ? Math.min(...contractorRows.map((item) => item.deviation)) : null;
  const worstDeviationNames = contractorRows.filter((item) => item.deviation === worstDeviation).map((item) => item.name);
  const bestDeviation = contractorRows.length ? Math.max(...contractorRows.map((item) => item.deviation)) : null;
  const bestDeviationNames = contractorRows.filter((item) => item.deviation === bestDeviation).map((item) => item.name);

  const byDecision = new Map();
  const noDecision = [];
  for (const contractor of contractorRows) {
    const rank = decisionMeta(contractor.decision).rank;
    if (!rank) {
      if (contractor.quality !== null && contractor.quality < 3.5) noDecision.push(contractor);
      continue;
    }
    if (!byDecision.has(contractor.decision)) byDecision.set(contractor.decision, []);
    byDecision.get(contractor.decision).push({
      ...contractor,
      rows: contractor.rows.filter((row) => decisionMeta(row.decision).rank === rank),
    });
  }
  const orderedDecisions = [...byDecision].sort((a, b) => decisionMeta(b[0]).rank - decisionMeta(a[0]).rank);
  const formedAt = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

  const contractorDetails = (contractor) => {
    const shortfall = contractor.rows.reduce((sum, row) => sum + Math.min(0, Number(row.deviation ?? (Number(row.actual_people || 0) - Number(row.plan_people || 0)))), 0);
    const dates = [...new Set(contractor.rows.filter((row) => Number(row.deviation ?? 0) < 0).map((row) => row.report_date).filter(Boolean))].sort();
    const reasons = [...new Set(contractor.rows.map((row) => row.cause).filter(Boolean))];
    const parts = [];
    if (shortfall < 0) {
      const shown = dates.slice(0, 3).map((date) => new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU')).join(', ');
      parts.push(`недобор ${Math.abs(shortfall).toFixed(0)} чел.${shown ? ` (${shown}${dates.length > 3 ? ` и ещё ${dates.length - 3}` : ''})` : ''}`);
    }
    if (reasons.length) parts.push(`причина: ${reasons.join('; ')}`);
    if (contractor.quality !== null) parts.push(`оценка ${contractor.quality.toFixed(1)}`);
    if (!parts.length) parts.push('решение зафиксировано руководителем проекта');
    return parts.join(', ');
  };

  const decisionSection = (title, items, key = title) => {
    const meta = decisionMeta(title);
    return <div className="summary-section" key={key}><div className={`summary-line ${meta.rank >= 4 ? 'neg' : 'neu'}`}>
      <span className={`decision-badge ${meta.cls}`}>{title}</span>
      <ul className="summary-sublist">{items.map((item, index) => <li key={item.name}>
        <span className="sub-num">{index + 1}.</span> <strong>{item.name}</strong> — <span className="sub-meta">{contractorDetails(item)}</span>
      </li>)}</ul>
    </div></div>;
  };

  return <Dialog open={open} onClose={onClose} modalRef={summaryRef} modalClassName="app-summary-modal" title={<>Краткое <span className="accent">резюме</span></>}
    footer={<><span className="summary-foot-info">{records.length ? `Сформировано ${formedAt}` : 'Нет данных для формирования отчёта.'}</span>{records.length > 0 && <div className="btn-group"><button onClick={() => onPng(summaryRef.current)} title="Скачать в PNG"><Icon name="download" />PNG</button></div>}</>}>
    {!records.length ? <div className="summary-section"><div className="summary-section-title">Нет данных</div></div> : <>
      <div className="summary-section"><div className={`summary-line ${kpi.percent >= 95 ? 'pos' : kpi.percent >= 80 ? 'neu' : 'neg'}`}>
        Общее выполнение плана: <strong>{kpi.percent.toFixed(1)}%</strong> (факт {kpi.fact.toFixed(0)} / план {kpi.plan.toFixed(0)}).
      </div></div>
      {hasQuality && <div className="summary-section"><div className={`summary-line ${qualityGrade(kpi.quality)?.tone || 'neu'}`}>
        Средняя оценка качества: <strong>{kpi.quality.toFixed(1)}</strong> из 5 — {qualityGrade(kpi.quality)?.level.toLocaleLowerCase('ru-RU') || 'нет оценки'}.
      </div></div>}
      {bestQuality !== null && <div className="summary-section"><div className="summary-line pos">
        {bestQualityNames.length > 1 ? 'Лучшие подрядчики' : 'Лучший подрядчик'} по качеству: <strong>{bestQualityNames.join(', ')}</strong> ({bestQuality.toFixed(1)} балла).
      </div></div>}
      {worstDeviation !== null && worstDeviation < 0
        ? <div className="summary-section"><div className="summary-line neg">Наибольшее отрицательное отклонение у {worstDeviationNames.length > 1 ? 'подрядчиков' : 'подрядчика'}: <strong>{worstDeviationNames.join(', ')}</strong> ({worstDeviation.toFixed(0)} чел.).</div></div>
        : bestDeviation !== null && bestDeviation > 0 && <div className="summary-section"><div className="summary-line pos">Наибольшее положительное отклонение у {bestDeviationNames.length > 1 ? 'подрядчиков' : 'подрядчика'}: <strong>{bestDeviationNames.join(', ')}</strong> ({bestDeviation.toFixed(0)} чел.).</div></div>}
      {orderedDecisions.map(([decision, items]) => decisionSection(decision, items))}
      {!orderedDecisions.length && <div className="summary-section"><div className="summary-line neu">Решения по подрядчикам не зафиксированы.</div></div>}
      {!!noDecision.length && decisionSection('Решение не указано, оценка ниже 3,5', noDecision, 'no-decision')}
      <div className="summary-section"><div className="summary-line neu">Всего подрядчиков: <strong>{contractorRows.length}</strong>.</div></div>
    </>}
  </Dialog>;
}

export default function App() {
  const canvasRef = useRef(null);
  const [session, setSession] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedObject, setSelectedObject] = useState('all');
  const [records, setRecords] = useState([]);
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [filters, setFilters] = useState({ contractors: [], workTypes: [], reasons: [], decisions: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [criteriaGroup, setCriteriaGroup] = useState(null);
  const [entrySetupOpen, setEntrySetupOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualContext, setManualContext] = useState({ objectId: '', reportDate: '' });
  const initialSection = ['people', 'resources', 'admin'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'people';
  const [activeSection, setActiveSection] = useState(initialSection);
  const openSection = (section) => { setActiveSection(section); window.location.hash = section; };
  const [theme, setTheme] = useState('light');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const notify = (message, type = 'success', retry = null) => {
    setToast({ message, type, retry });
    window.clearTimeout(notify.timeout);
    if (type !== 'error') notify.timeout = window.setTimeout(() => setToast(null), 3500);
  };

  const loadObjects = async (preserveSelection = true) => {
    const data = await api('/api/objects');
    setObjects(data.objects);
    if (!preserveSelection || (selectedObject !== 'all' && !data.objects.some((o) => String(o.id) === String(selectedObject)))) {
      const latest = [...data.objects].sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')))[0];
      setSelectedObject(latest ? String(latest.id) : 'all');
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await api(`/api/records?objectId=${encodeURIComponent(selectedObject)}`);
      setRecords(data.records);
      setDates(data.availableDates);
      setDate((current) => {
        const next = data.availableDates.includes(current) ? current : data.availableDates.at(-1) || '';
        setPeriodStart(next); setPeriodEnd(next); return next;
      });
    } catch (error) { notify(error.message, 'error', loadRecords); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    Promise.all([api('/api/session'), api('/api/objects')]).then(([sessionData, objectData]) => {
      setSession(sessionData); setObjects(objectData.objects);
      const latest = [...objectData.objects].sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')))[0];
      setSelectedObject(latest ? String(latest.id) : 'all');
    }).catch((error) => notify(error.message, 'error'));
  }, []);
  useEffect(() => { if (session) loadRecords(); }, [session, selectedObject]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const dateRows = useMemo(() => records.filter((row) => (!periodStart || row.report_date >= periodStart) && (!periodEnd || row.report_date <= periodEnd)), [records, periodStart, periodEnd]);
  const visibleRecords = useMemo(() => dateRows.filter((row) =>
    (!filters.contractors.length || filters.contractors.includes(row.contractor)) &&
    (!filters.workTypes.length || filters.workTypes.includes(row.work_type)) &&
    (!filters.reasons.length || filters.reasons.includes(row.cause)) &&
    (!filters.decisions.length || filters.decisions.includes(row.decision))), [dateRows, filters]);
  const activeFilterCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);
  const filterSummary = [['Подрядчики', filters.contractors], ['Виды работ', filters.workTypes], ['Причины', filters.reasons], ['Решения', filters.decisions]].filter(([, values]) => values.length).map(([label, values]) => `${label}: ${values.length}`).join(' • ');
  const canEnterData = ['administrator', 'project_manager'].includes(session?.user.role);
  const filledRows = dateRows.filter((row) => row.actual_people !== null && row.actual_people !== undefined).length;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const entryLabel = date && date < today ? 'Заполнить отчёт' : filledRows && filledRows < dateRows.length ? 'Продолжить заполнение' : filledRows && dateRows.length ? 'Исправить сегодня' : 'Внести данные';

  const toggleFilter = (key, value) => setFilters((old) => ({ ...old, [key]: old[key].includes(value) ? old[key].filter((x) => x !== value) : [...old[key], value] }));
  const clearFilters = () => setFilters({ contractors: [], workTypes: [], reasons: [], decisions: [] });
  const clearFilterGroup = (key) => setFilters((current) => ({ ...current, [key]: [] }));
  const contextRecord = [...dateRows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
  const contextObject = selectedObject === 'all' ? 'Все доступные объекты' : objects.find((item) => String(item.id) === String(selectedObject))?.name || 'Объект';
  const shortName = (name = '') => { const parts = name.trim().split(/\s+/); return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : name; };
  const updatedContext = contextRecord?.updated_at ? `${selectedObject === 'all' ? `Данные по ${new Set(dateRows.map((row) => row.object_id)).size} объектам • последнее ` : ''}обновлено ${new Date(`${contextRecord.updated_at.replace(' ', 'T')}Z`).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${selectedObject !== 'all' && contextRecord.updated_by ? `, ${shortName(contextRecord.updated_by)}` : ''}` : '';
  const formatShortDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU') : '';
  const periodLabel = periodStart ? (periodEnd && periodEnd !== periodStart ? `${formatShortDate(periodStart)} — ${formatShortDate(periodEnd)}` : formatShortDate(periodStart)) : '';
  const clearHeaderFilters = () => { setSelectedObject('all'); setPeriodStart(''); setPeriodEnd(''); setDate(''); clearFilters(); };
  const releaseManualLock = () => {
    if (!manualContext.readOnly && manualContext.objectId && manualContext.reportDate) api('/api/manual/lock', { method: 'DELETE', body: JSON.stringify({ objectId: Number(manualContext.objectId), reportDate: manualContext.reportDate }) }).catch(() => {});
  };

  const capture = async (target, name) => {
    if (!target) return notify('Не найден блок для экспорта.', 'error');
    const exportId = `export-${crypto.randomUUID()}`;
    target.dataset.exportId = exportId;
    try {
      const width = target.scrollWidth;
      const scrollBody = target.querySelector('.summary-body');
      const height = scrollBody
        ? Math.max(target.scrollHeight, target.offsetHeight - scrollBody.clientHeight + scrollBody.scrollHeight)
        : target.scrollHeight;
      const snapshot = await html2canvas(target, {
        scale: 2, useCORS: true, logging: false, width, height,
        windowWidth: Math.max(width, window.innerWidth), windowHeight: Math.max(height, window.innerHeight),
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F4F7FC',
        onclone: (documentClone) => {
          const clone = documentClone.querySelector(`[data-export-id="${exportId}"]`);
          if (!clone) return;
          clone.style.setProperty('transform', 'none', 'important');
          clone.style.setProperty('position', 'absolute', 'important');
          clone.style.setProperty('top', '0', 'important');
          clone.style.setProperty('left', '0', 'important');
          clone.style.setProperty('width', `${width}px`, 'important');
          clone.style.setProperty('height', `${height}px`, 'important');
          clone.style.setProperty('max-height', 'none', 'important');
          clone.style.setProperty('overflow', 'visible', 'important');
          clone.querySelectorAll('.summary-body').forEach((body) => {
            body.style.setProperty('overflow', 'visible', 'important');
            body.style.setProperty('max-height', 'none', 'important');
          });
        },
      });
      const link = document.createElement('a'); link.download = name; link.href = snapshot.toDataURL('image/png'); link.click();
    } catch (error) { notify(`Не удалось создать PNG: ${error.message}`, 'error'); }
    finally { delete target.dataset.exportId; }
  };

  return <>
    <aside className="app-sidebar">
      <div className="sidebar-brand sidebar-enko-brand"><img src="/enko-logo.png" alt="ЕНКО — строительный холдинг" /></div>
      <nav className="sidebar-nav" aria-label="Разделы приложения">
        <button className={activeSection === 'people' ? 'active' : ''} onClick={() => openSection('people')}><Icon name="summary" /><span>Отчёт по людям</span></button>
        <button className={activeSection === 'resources' ? 'active' : ''} onClick={() => openSection('resources')}><Icon name="edit" /><span>Отработка подрядчиков</span></button>
        {session?.user.role === 'administrator' && <button className={activeSection === 'admin' ? 'active' : ''} onClick={() => openSection('admin')}><Icon name="admin" /><span>Администрирование</span></button>}
      </nav>
      <div className="sidebar-footer">{session?.authMode === 'dev' && <label className="sidebar-role-switch"><span>Тестовая роль</span><ComboBox value={session.user.id} onChange={setDevUserId} options={(session.devUsers || []).map((user) => ({ value: user.id, label: `${user.name} — ${roleNames[user.role]}` }))} /></label>}<div className="sidebar-user"><strong>{session?.user.name || 'Загрузка…'}</strong><span>{roleNames[session?.user.role] || ''}</span></div><button className="sidebar-theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /><span>{theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</span></button></div>
    </aside>

    {activeSection === 'people' && <div className="canvas" ref={canvasRef}>
      <header className="people-heading report-prototype-heading"><div className="people-heading-title"><h1>ОТЧЁТ ПО <span className="accent">ЛЮДЯМ</span></h1><div className="people-update-context"><span />{loading ? 'обновляем…' : updatedContext}</div></div><div className="people-heading-filters"><label className="filter-field report-object-field"><ComboBox value={selectedObject} onChange={(value) => setSelectedObject(value || 'all')} options={[{ value: 'all', label: 'Все объекты' }, ...objects.map((item) => ({ value: item.id, label: item.name }))]} placeholder="Все объекты" /></label><div className="filter-field report-period-field"><DateRangeField start={periodStart} end={periodEnd} onChange={(start, end) => { setPeriodStart(start); setPeriodEnd(end); setDate(end || start); }} allowedDates={dates} placeholder="Весь период" clearable /></div><button className={`more-filters ${activeFilterCount ? 'has-active' : ''}`} title={filterSummary || 'Дополнительные фильтры не выбраны'} aria-label={filterSummary || 'Открыть дополнительные фильтры'} onClick={() => setFilterOpen(true)}>Ещё фильтры{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button><button type="button" className="report-header-reset" onClick={clearHeaderFilters}>Сбросить фильтры</button></div><div className="people-heading-actions">{canEnterData && <button className="people-entry-primary manual-entry-trigger" onClick={() => setEntrySetupOpen(true)}><Icon name="edit" />Заполнить отчёт</button>}<button className="people-text-action" onClick={() => setSummaryOpen(true)}>Резюме</button>{visibleRecords.length > 0 && <button className="people-text-action" onClick={() => capture(canvasRef.current, 'Мониторинг_стройки_дашборд.png')}>Скачать</button>}</div></header>
      {loading ? <DashboardSkeleton /> : !visibleRecords.length ? <DashboardEmptyState canEdit={canEnterData} hasFilters={activeFilterCount > 0}
        hasDates={dates.length > 1} onEnter={() => setEntrySetupOpen(true)} onReset={clearFilters}
        onDate={() => document.querySelector('.topbar-field .ui-date-input')?.click()} /> : <><Kpis records={visibleRecords} />
      <div className="panels-grid">
        <DetailTable records={visibleRecords} filters={filters} toggleFilter={toggleFilter} onCriteria={setCriteriaGroup} />
        <div className="panel charts-panel"><div className="charts-stack">
          <Ranking records={visibleRecords} type="people" filters={filters} toggleFilter={toggleFilter} />
          <Ranking records={visibleRecords} type="quality" filters={filters} toggleFilter={toggleFilter} />
        </div></div>
      </div></>}
    </div>}

    {activeSection === 'resources' && <main className="section-host"><ResourceDepartmentPage canEdit={['administrator', 'resource_manager'].includes(session?.user.role)} objects={objects} selectedObject={selectedObject} setSelectedObject={setSelectedObject} dates={dates} date={date} records={records} notify={notify} userId={session?.user?.id} /></main>}
    {activeSection === 'admin' && <main className="section-host"><AdminPage session={session} notify={notify} onObjectsChanged={() => loadObjects()} onRecordsChanged={() => loadRecords()} /></main>}

    <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} records={records}
      filters={filters} setFilters={setFilters} />
    <CriteriaModal group={criteriaGroup} onClose={() => setCriteriaGroup(null)} />
    <SummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} records={visibleRecords}
      onPng={(target) => capture(target, 'Краткое_резюме.png')} />
    <EntrySetupModal open={entrySetupOpen} onClose={() => setEntrySetupOpen(false)} objects={objects} initialObjectId={selectedObject} notify={notify}
      onContinue={(context) => { setManualContext(context); setEntrySetupOpen(false); setManualOpen(true); }} />
    <ManualEntryModal open={manualOpen} readOnly={manualContext.readOnly} userId={session?.user?.id} onClose={() => { releaseManualLock(); setManualOpen(false); }} objects={objects} initialObjectId={manualContext.objectId}
      initialReportDate={manualContext.reportDate}
      onChangeContext={() => { releaseManualLock(); setManualOpen(false); setEntrySetupOpen(true); }}
      notify={notify} onSaved={async () => { await loadObjects(); await loadRecords(); }}
      onDashboard={({ objectId, reportDate }) => { setSelectedObject(String(objectId)); setDate(reportDate); clearFilters(); setManualOpen(false); openSection('people'); }} />
    {toast && <div className={`toast ${toast.type} show`} role={toast.type === 'error' ? 'alert' : 'status'}><span className="toast-icon">{toast.type === 'error' ? '×' : '✓'}</span><span className="toast-text">{toast.message}</span>{toast.retry && <button onClick={() => { setToast(null); toast.retry(); }}>Повторить</button>}{toast.type === 'error' && <button className="toast-close" onClick={() => setToast(null)} aria-label="Закрыть">×</button>}</div>}
  </>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" aria-label="Загрузка данных"><div className="skeleton-kpis">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div><div className="skeleton-panels"><span /><span /></div></div>;
}

function DashboardEmptyState({ canEdit, hasFilters, hasDates, onEnter, onReset, onDate }) {
  return <div className="dashboard-empty-state">
    <div className="dashboard-empty-icon">0</div>
    <h2>Нет данных для отображения</h2>
    <p>{hasFilters ? 'Текущие фильтры не нашли подходящих строк.' : 'Для выбранного объекта и даты отчёт ещё не заполнен.'}</p>
    <div>{canEdit && <button className="manual-save-btn" onClick={onEnter}>Внести данные</button>}{hasFilters && <button className="manual-cancel-btn" onClick={onReset}>Сбросить фильтры</button>}{hasDates && <button className="manual-cancel-btn" onClick={onDate}>Выбрать другую дату</button>}</div>
  </div>;
}
