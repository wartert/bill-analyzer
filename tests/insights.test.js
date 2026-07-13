const test = require('node:test');
const assert = require('node:assert/strict');
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
