export const WORK_TYPES = [
  'Демонтаж', 'Разнорабочие', 'Монолит', 'Кладка', 'Металл', 'Кровля', 'Фасад',
  'Отделка', 'Окна ПВХ', 'Отопление', 'ВК', 'Вентиляция', 'Электрика',
  'Перегородки', 'Слаботочные сети', 'НО/НЭС', 'Н В К', 'Ограждения',
  'Наружные сети связи', 'Теплотрасса', 'Огнезащита', 'Котельная (ИТП)', 'Лифт',
  'Благоустройство', 'Устройство свай', 'Оборудование кухонь', 'Собственные силы',
  'Монтаж текстильных стен', 'Шторы', 'Двери', 'Мебель',
];

export const CAUSES = [
  'нет готовности', 'нет подрядчика', 'нет материалов', 'нет проекта', 'нет оплаты',
  'фронт и материалы есть, нет людей',
  'Фронт есть, нет людей и материалов от подрядчика',
  'Фронт есть, материалы есть, людей нет',
  'Отпуск или командировка', 'Пятница',
];

export const DECISIONS = [
  'Отправить претензию', 'Затребовано усиление', 'Не принял решений',
  'Отправить уведомление со сроком устранения',
  'Подрядчик не выбран - нужно найти', 'Заменить действующего подрядчика',
];

export const QUALITY_CRITERIA = [
  {
    key: 'workQualityFact', field: 'work_quality_fact', title: 'Качество выполнения работ', weight: 0.2,
    options: [
      [5, 'Замечаний и предписаний СК нет'], [4, 'Несущественные замечания, устранены в срок'],
      [3, 'Несущественные замечания, устраняются с задержкой'], [2, 'Критическое замечание (брак) - впервые'],
      [1, 'Критическое замечание - повторно'], [0, 'Работы не приняты: неустранимый брак'],
    ],
  },
  {
    key: 'disciplineFact', field: 'discipline_fact', title: 'Дисциплина (ТБ, охрана труда, СИЗ)', weight: 0.2,
    options: [
      [5, 'Все в СИЗ, нарушений ТБ нет'], [4, 'Единичные нарушения (1–2 чел.), сразу устранены'],
      [3, 'Регулярно нарушают 10–20% работников'], [2, 'Более 30% без СИЗ или грубые нарушения ТБ'],
      [1, 'Без СИЗ более половины бригады, работы остановлены'], [0, 'Отказ соблюдать ТБ, работы запрещены'],
    ],
  },
  {
    key: 'peopleCountFact', field: 'people_count_fact', title: 'Количество людей на объекте', weight: 0.2,
    options: [
      [5, 'Явка 90-100% от реальной потребности'], [4, 'Явка 75–90%'], [3, 'Явка 60–75%'],
      [2, 'Явка 45–60%'], [1, 'Явка 30–45%'], [0, 'Явка менее 30%, срыв смены'],
    ],
  },
  {
    key: 'productivityFact', field: 'productivity_fact', title: 'Выполнение запланированного объёма', weight: 0.2,
    options: [
      [5, 'План выполнен на 90-100%'], [4, 'Выполнено 75–90%'], [3, 'Выполнено 60–75%'],
      [2, 'Выполнено 45–60%'], [1, 'Выполнено 30–45%'], [0, 'Выполнено менее 30%, план провален'],
    ],
  },
  {
    key: 'cleanlinessFact', field: 'cleanliness_fact', title: 'Чистота на рабочем месте', weight: 0.2,
    options: [
      [5, 'Ежедневная уборка, замечаний нет'], [4, 'Мелкий мусор, убирают после замечания'],
      [3, 'Уборка не ежедневная, убирают после напоминания'], [2, 'Убирают после нескольких напоминаний'],
      [1, 'Уборка не производится, мусор не вывозится'], [0, 'Захламлено, угроза безопасности'],
    ],
  },
];

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

const CONTRACTOR_FAULT_CAUSES = new Set([
  'фронт и материалы есть нет людей',
  'фронт есть нет людей и материалов от подрядчика',
  'фронт есть материалы есть людей нет',
]);

function isContractorFaultCause(value) {
  return CONTRACTOR_FAULT_CAUSES.has(normalized(value).replace(/[,.]/g, ''));
}

function isOwnForces(row) {
  return normalized(row.workType) === 'собственные силы' || normalized(row.contractor) === 'собственные силы';
}

export function isFriday(date) {
  return isIsoDate(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 5;
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function qualityScores(row) {
  return Object.fromEntries(QUALITY_CRITERIA.map((criterion) => {
    const value = String(row[criterion.key] || '').trim();
    return [`${criterion.field.replace(/_fact$/, '')}_score`, criterion.options.find(([, text]) => text === value)?.[0] ?? null];
  }));
}

export function qualityScore(row) {
  let weighted = 0;
  let weights = 0;
  for (const criterion of QUALITY_CRITERIA) {
    const value = String(row[criterion.key] || '').trim();
    if (!value) continue;
    const option = criterion.options.find(([, text]) => text === value);
    if (!option) return null;
    weighted += option[0] * criterion.weight;
    weights += criterion.weight;
  }
  return weights ? Math.round(weighted / weights * 10) / 10 : null;
}

export function validateManualReport({ reportDate, rows, weeklyFacts = {} }) {
  const errors = [];
  if (!isIsoDate(reportDate)) {
    errors.push({ row: null, field: 'reportDate', message: 'Укажите корректную дату отчёта.' });
  }
  rows.forEach((row, index) => {
    const number = index + 1;
    if (!String(row.contractor || '').trim()) errors.push({ row: number, field: 'contractor', message: 'Выберите подрядчика.' });
    if (!String(row.workType || '').trim()) errors.push({ row: number, field: 'workType', message: 'Выберите вид работы.' });
    if (String(row.detail || '').length > 30) errors.push({ row: number, field: 'detail', message: 'Детализация — не более 30 символов.' });
    if (String(row.contractor || '').length > 30) errors.push({ row: number, field: 'contractor', message: 'Подрядчик — не более 30 символов.' });
    for (const field of ['planPeople', 'actualPeople']) {
      if (row[field] === null || row[field] === '') continue;
      const value = Number(row[field]);
      if (!Number.isInteger(value) || value < 0) errors.push({ row: number, field, message: 'План и факт должны быть целыми неотрицательными числами.' });
    }
    for (const criterion of QUALITY_CRITERIA) {
      const selected = String(row[criterion.key] || '').trim();
      if (selected && !criterion.options.some(([, text]) => text === selected)) {
        errors.push({ row: number, field: 'quality', message: `Некорректное значение критерия «${criterion.title}».` });
      }
    }
    if (row.actualPeople === null || row.actualPeople === '' || isOwnForces(row)) return;
    const plan = Number(row.planPeople || 0);
    const actual = Number(row.actualPeople);
    if (actual < plan && !String(row.cause || '').trim()) {
      errors.push({ row: number, field: 'cause', message: 'При факте меньше плана укажите причину.' });
    }
    if (isContractorFaultCause(row.cause) && !String(row.decision || '').trim()) {
      errors.push({ row: number, field: 'decision', message: 'Для этой причины необходимо выбрать решение.' });
    }
    if (!isFriday(reportDate) || !String(row.contractor || '').trim() || normalized(row.decision).includes('не выбран')) return;
    const weekFact = Number(weeklyFacts[normalized(row.contractor)] || 0) + actual;
    const filled = QUALITY_CRITERIA.filter((criterion) => String(row[criterion.key] || '').trim()).length;
    if (weekFact > 0 && filled < QUALITY_CRITERIA.length) {
      errors.push({ row: number, field: 'quality', message: `В пятницу заполните все 5 критериев качества (заполнено ${filled}).` });
    }
  });
  const identities = new Set();
  rows.forEach((row, index) => {
    const identity = [row.workType, row.detail, row.contractor].map(normalized).join('\u001f');
    if (identities.has(identity)) errors.push({ row: index + 1, field: 'workType', message: 'Строка с таким видом работы, детализацией и подрядчиком уже есть.' });
    identities.add(identity);
  });
  return errors;
}
