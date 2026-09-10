import { describe, expect, it } from 'vitest';
import { isFriday, liveErrorsFor } from './ManualEntryModal.jsx';

const row = (overrides = {}) => ({
  workType: 'Монолит', contractor: 'Подрядчик', planPeople: 10, actualPeople: 8,
  cause: '', decision: '', workQualityFact: '', disciplineFact: '',
  peopleCountFact: '', productivityFact: '', cleanlinessFact: '', ...overrides,
});

describe('live manual-entry validation', () => {
  it('requires a cause immediately after entering a fact below plan', () => {
    expect(liveErrorsFor([row()], '2026-09-03')).toContainEqual({
      row: 1, field: 'cause', message: 'Укажите причину отклонения.',
    });
  });

  it('requires a project-manager decision for contractor fault', () => {
    for (const cause of ['фронт и материалы есть, нет людей', 'Фронт есть, нет людей и материалов от подрядчика', 'Фронт есть, материалы есть, людей нет']) {
      const errors = liveErrorsFor([row({ cause })], '2026-09-03');
      expect(errors.some((error) => error.field === 'decision')).toBe(true);
    }
  });

  it('marks all five quality criteria as required on Friday', () => {
    expect(isFriday('2026-09-04')).toBe(true);
    const errors = liveErrorsFor([row({ actualPeople: 5 })], '2026-09-04');
    expect(errors.some((error) => error.field === 'quality')).toBe(true);
  });
});
