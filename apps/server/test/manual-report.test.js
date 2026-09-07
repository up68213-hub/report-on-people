import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_CRITERIA, qualityScore, validateManualReport } from '../src/manual/manual-report.js';

const completeQuality = Object.fromEntries(QUALITY_CRITERIA.map((criterion) => [criterion.key, criterion.options[1][1]]));

test('calculates the hidden weighted quality score from selected phrases', () => {
  assert.equal(qualityScore(completeQuality), 4);
  assert.equal(qualityScore({ workQualityFact: QUALITY_CRITERIA[0].options[0][1] }), 5);
});

test('requires a cause for a shortfall and a decision for contractor fault', () => {
  const base = { workType: 'Отделка', contractor: 'Подрядчик', planPeople: 10, actualPeople: 5 };
  let errors = validateManualReport({ reportDate: '2026-08-31', rows: [base] });
  assert.equal(errors[0].field, 'cause');
  errors = validateManualReport({ reportDate: '2026-08-31', rows: [{ ...base, cause: 'фронт и материалы есть, нет людей' }] });
  assert.equal(errors[0].field, 'decision');
  errors = validateManualReport({ reportDate: '2026-08-31', rows: [{ ...base, workType: 'Собственные силы' }] });
  assert.equal(errors.length, 0);
});

test('requires all five criteria on Friday when weekly attendance is non-zero', () => {
  const row = { workType: 'Отделка', contractor: 'Подрядчик', planPeople: 2, actualPeople: 1, cause: 'нет материалов' };
  assert.equal(validateManualReport({ reportDate: '2026-09-04', rows: [row] })[0].field, 'quality');
  assert.equal(validateManualReport({ reportDate: '2026-09-04', rows: [{ ...row, ...completeQuality }] }).length, 0);
  assert.equal(validateManualReport({ reportDate: '2026-09-04', rows: [{ ...row, actualPeople: 0 }], weeklyFacts: {} }).length, 0);
});

test('rejects duplicate business keys in one manual report', () => {
  const row = { workType: 'Отделка', detail: 'Этаж 1', contractor: 'Подрядчик', planPeople: 2, actualPeople: '' };
  const errors = validateManualReport({ reportDate: '2026-08-31', rows: [row, { ...row }] });
  assert.equal(errors.at(-1).message, 'Строка с таким видом работы, детализацией и подрядчиком уже есть.');
});
