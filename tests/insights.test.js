const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Insights = require('../src/insights.js');

function expense(id, date, time, amount, merchant = '测试商户', categoryId = 'food', description = '') {
  return {
    id, date, time, datetime: `${date} ${time}`.trim(), amount,
    flowType: 'expense', merchant, categoryId,
    categoryName: categoryId === 'food' ? '餐饮美食' : '购物消费',
    description, searchText: `${merchant} ${description}`,
  };
}

function analysis(transactions, monthly = []) {
  return { transactions, monthly, changeDrivers: [], summary: { netExpense: 0 } };
}

test('time profile separates workdays, weekends and late-night spending', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('a', '2026-07-10', '12:10:00', 28),
    expense('b', '2026-07-11', '23:20:00', 60),
    expense('c', '2026-07-12', '', 20),
  ]));
  assert.deepEqual(result.weekPattern, {
    weekday: { amount: 28, count: 1, average: 28 },
    weekend: { amount: 80, count: 2, average: 40 },
  });
  assert.equal(result.timeProfile.buckets.find((item) => item.id === 'late-night').amount, 60);
  assert.equal(result.timeProfile.missingTimeCount, 1);
});

test('heatmap exposes all seven weekdays and five named time buckets', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('a', '2026-07-06', '08:00:00', 10),
  ]));
  assert.equal(result.timeProfile.heatmap.length, 35);
  assert.deepEqual(result.timeProfile.buckets.map((item) => item.id), [
    'morning', 'noon', 'afternoon', 'evening', 'late-night',
  ]);
  assert.deepEqual(result.timeProfile.heatmap[0], {
    weekday: 1, bucket: 'morning', amount: 10, count: 1,
  });
});

test('week pattern excludes missing and impossible dates while accepting leap day', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('missing', '', '08:00:00', 10),
    expense('impossible', '2026-02-30', '08:00:00', 20),
    expense('leap-day', '2024-02-29', '08:00:00', 30),
  ]));

  assert.equal(Insights.weekdayNumber(''), null);
  assert.equal(Insights.weekdayNumber('2026-02-30'), null);
  assert.equal(Insights.weekdayNumber('2024-02-29'), 4);
  assert.deepEqual(result.weekPattern, {
    weekday: { amount: 30, count: 1, average: 30 },
    weekend: { amount: 0, count: 0, average: 0 },
  });
});

test('profile ignores income and refunds', () => {
  const income = { ...expense('income', '2026-07-06', '08:00:00', 20), flowType: 'income' };
  const refund = { ...expense('refund', '2026-07-06', '08:00:00', 30), flowType: 'refund' };
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('expense', '2026-07-06', '08:00:00', 10),
    income,
    refund,
  ]));

  assert.deepEqual(result.weekPattern.weekday, { amount: 10, count: 1, average: 10 });
  assert.deepEqual(
    result.timeProfile.buckets.find((item) => item.id === 'morning'),
    { id: 'morning', label: '早晨', amount: 10, count: 1, average: 10 },
  );
});

test('time bucket boundaries cover every hour transition', () => {
  const cases = [
    ['05:00:00', 'late-night'],
    ['06:00:00', 'morning'],
    ['10:59:59', 'morning'],
    ['11:00:00', 'noon'],
    ['13:59:59', 'noon'],
    ['14:00:00', 'afternoon'],
    ['17:59:59', 'afternoon'],
    ['18:00:00', 'evening'],
    ['21:59:59', 'evening'],
    ['22:00:00', 'late-night'],
  ];

  assert.deepEqual(cases.map(([time]) => Insights.bucketFor(time).id), cases.map(([, id]) => id));
});

test('browser UMD exposes the insights API without CommonJS globals', () => {
  const context = {};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/insights.js', 'utf8'), context);

  assert.equal(context.window.BillAnalyzerInsights.TIME_BUCKETS.length, 5);
  assert.equal(typeof context.window.BillAnalyzerInsights.analyzeSpendingProfile, 'function');
});
