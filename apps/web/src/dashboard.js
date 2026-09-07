export const QUALITY_SCALE = [
  { min: 4.5, level: 'Отлично', cls: 'q-good', tone: 'pos' },
  { min: 3.5, level: 'Хорошо', cls: 'q-ok', tone: 'pos' },
  { min: 2.5, level: 'Требует внимания', cls: 'q-warn', tone: 'neu' },
  { min: -1, level: 'Критично', cls: 'q-bad', tone: 'neg' },
];

export const CRITERIA = [
  ['Качество выполнения работ', 'work_quality_fact'],
  ['Дисциплина (ТБ, СИЗ)', 'discipline_fact'],
  ['Количество людей на объекте', 'people_count_fact'],
  ['Выполнение объёма', 'productivity_fact'],
  ['Чистота на рабочем месте', 'cleanliness_fact'],
];

export const DECISION_STYLES = [
  { match: 'замен', rank: 6, cls: 'd-replace' },
  { match: 'приостанов', rank: 6, cls: 'd-replace' },
  { match: 'не выбран', rank: 5, cls: 'd-search' },
  { match: 'претенз', rank: 4, cls: 'd-claim' },
  { match: 'уведомлен', rank: 3, cls: 'd-notice' },
  { match: 'усилен', rank: 2, cls: 'd-boost' },
  { match: 'не принял', rank: 1, cls: 'd-none' },
];

export const FAULT_REASONS = [
  'фронт и материалы есть, нет людей',
  'нет людей',
  'подводит подрядчик',
];

export function qualityGrade(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return QUALITY_SCALE.find((grade) => Number(value) >= grade.min) || QUALITY_SCALE.at(-1);
}

export function decisionMeta(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('ru-RU');
  if (!normalized) return { rank: 0, cls: 'd-none' };
  return DECISION_STYLES.find((item) => normalized.includes(item.match)) || { rank: 1, cls: 'd-none' };
}

export function isOwnForces(row) {
  return [row.work_type, row.contractor].some((value) => String(value || '').trim().toLocaleLowerCase('ru-RU') === 'собственные силы');
}

export function isContractorFault(reason) {
  const normalized = String(reason || '').trim().toLocaleLowerCase('ru-RU');
  return FAULT_REASONS.some((fragment) => normalized.includes(fragment));
}

export function aggregateTable(records) {
  const groups = new Map();
  for (const row of records) {
    const own = isOwnForces(row);
    const contractor = own ? (row.detail || 'Собственные силы') : (row.contractor || '—');
    const key = `${own ? 'own' : 'contractor'}|${row.work_type}|${contractor}`;
    if (!groups.has(key)) {
      groups.set(key, {
        work: row.work_type || '—', contractor, isOwn: own, plan: 0, fact: 0,
        qualities: [], reasons: new Set(), decisions: new Set(), rows: [],
      });
    }
    const group = groups.get(key);
    group.plan += Number(row.plan_people || 0);
    group.fact += Number(row.actual_people || 0);
    if (row.quality_score !== null) group.qualities.push(Number(row.quality_score));
    if (row.cause) group.reasons.add(row.cause);
    if (row.decision) group.decisions.add(row.decision);
    group.rows.push(row);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    deviation: group.fact - group.plan,
    quality: group.qualities.length
      ? group.qualities.reduce((sum, value) => sum + value, 0) / group.qualities.length
      : null,
    decision: [...group.decisions].sort((a, b) => decisionMeta(b).rank - decisionMeta(a).rank)[0] || '',
  })).sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
}

export function calculateKpis(records) {
  const plan = records.reduce((sum, row) => sum + Number(row.plan_people || 0), 0);
  const fact = records.reduce((sum, row) => sum + Number(row.actual_people || 0), 0);
  const qualityValues = records
    .map((row) => row.quality_score)
    .filter((value) => value !== null && Number.isFinite(Number(value)))
    .map(Number);
  return {
    plan,
    fact,
    percent: plan ? fact / plan * 100 : 0,
    quality: qualityValues.length
      ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length
      : 0,
  };
}
