import { describe, expect, it } from 'vitest';
import { aggregateTable, calculateKpis, decisionMeta, isContractorFault } from './dashboard.js';

describe('dashboard rules', () => {
  it('calculates totals', () => {
    expect(calculateKpis([
      { plan_people: 10, actual_people: 8, quality_score: 4 },
      { plan_people: 5, actual_people: 5, quality_score: 5 },
    ])).toEqual({ plan: 15, fact: 13, percent: 86.66666666666667, quality: 4.5 });
  });

  it('groups own forces by detail', () => {
    const groups = aggregateTable([
      { work_type: 'Собственные силы', detail: 'ИТР', plan_people: 2, actual_people: 1 },
    ]);
    expect(groups[0].contractor).toBe('ИТР');
  });

  it('keeps prototype ranking rules', () => {
    expect(isContractorFault('Фронт и материалы есть, нет людей')).toBe(true);
    expect(decisionMeta('Заменить действующего подрядчика').rank).toBe(6);
  });
});
