const test = require('node:test');
const assert = require('node:assert/strict');
const Budget = require('../src/budget.js');

test('normalization keeps non-negative totals and category values', () => {
  assert.deepEqual(Budget.normalizeBudget({ total: '7000', categories: { food: '1500', shopping: '-2' } }), {
    total: 7000,
    categories: { food: 1500, shopping: 0 },
  });
});

test('budget status uses current-month expenses and projects to month end', () => {
  const status = Budget.calculateBudget({
    meta: { lastDate: '2026-07-10' },
    transactions: [
      { date: '2026-07-02', flowType: 'expense', amount: 1000, categoryId: 'food' },
      { date: '2026-07-03', flowType: 'refund', amount: 100, categoryId: 'food' },
      { date: '2026-06-20', flowType: 'expense', amount: 9000, categoryId: 'food' },
    ],
  }, { total: 3100, categories: { food: 1500 } });

  assert.equal(status.spent, 900);
  assert.equal(status.remaining, 2200);
  assert.equal(status.progress, 29);
  assert.equal(status.projected, 2790);
  assert.deepEqual(status.categories.food, { limit: 1500, spent: 900, remaining: 600, progress: 60 });
});

test('storage helpers fail closed without throwing', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };

  assert.deepEqual(Budget.loadBudget(storage), { total: 0, categories: {} });
  assert.equal(Budget.saveBudget({ total: 1 }, storage), false);
  assert.equal(Budget.clearBudget(storage), false);
});

test('missing analysis dates do not project unrelated transactions', () => {
  const status = Budget.calculateBudget({
    meta: { lastDate: '' },
    transactions: [{ date: '2026-07-01', flowType: 'expense', amount: 500, categoryId: 'food' }],
  }, { total: 1000, categories: {} });

  assert.equal(status.month, '');
  assert.equal(status.spent, 0);
  assert.equal(status.projected, 0);
});
