(function initBillAnalyzerInsights(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerInsights() {
  'use strict';

  const TIME_BUCKETS = [
    { id: 'morning', label: '早晨', matches: (hour) => hour >= 6 && hour <= 10 },
    { id: 'noon', label: '午间', matches: (hour) => hour >= 11 && hour <= 13 },
    { id: 'afternoon', label: '下午', matches: (hour) => hour >= 14 && hour <= 17 },
    { id: 'evening', label: '傍晚', matches: (hour) => hour >= 18 && hour <= 21 },
    { id: 'late-night', label: '深夜', matches: (hour) => hour >= 22 || hour <= 5 },
  ];

  const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const expensesOf = (analysis) => (analysis.transactions || []).filter((item) => item.flowType === 'expense');

  function weekdayNumber(date) {
    if (!/^20\d{2}-\d{2}-\d{2}$/u.test(date || '')) return null;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    const nativeDay = parsed.getUTCDay();
    return nativeDay === 0 ? 7 : nativeDay;
  }

  function bucketFor(time) {
    const match = /^(\d{1,2}):/u.exec(time || '');
    if (!match) return null;
    const hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    return TIME_BUCKETS.find((bucket) => bucket.matches(hour)) || null;
  }

  function aggregate(items) {
    const amount = roundMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    return { amount, count: items.length, average: items.length ? roundMoney(amount / items.length) : 0 };
  }

  function buildWeekPattern(expenses) {
    return {
      weekday: aggregate(expenses.filter((item) => {
        const weekday = weekdayNumber(item.date);
        return weekday >= 1 && weekday <= 5;
      })),
      weekend: aggregate(expenses.filter((item) => {
        const weekday = weekdayNumber(item.date);
        return weekday >= 6 && weekday <= 7;
      })),
    };
  }

  function buildTimeProfile(expenses) {
    const cells = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      TIME_BUCKETS.forEach((bucket) => {
        const matches = expenses.filter((item) => weekdayNumber(item.date) === weekday && bucketFor(item.time)?.id === bucket.id);
        const { amount, count } = aggregate(matches);
        cells.push({ weekday, bucket: bucket.id, amount, count });
      });
    }
    return {
      buckets: TIME_BUCKETS.map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        ...aggregate(expenses.filter((item) => bucketFor(item.time)?.id === bucket.id)),
      })),
      heatmap: cells,
      missingTimeCount: expenses.filter((item) => !bucketFor(item.time)).length,
    };
  }

  function analyzeSpendingProfile(analysis) {
    const expenses = expensesOf(analysis);
    return {
      weekPattern: buildWeekPattern(expenses),
      timeProfile: buildTimeProfile(expenses),
      monthlyComparison: null,
      merchants: [],
      mealScenes: [],
      habits: [],
      recommendations: [],
    };
  }

  return { TIME_BUCKETS, analyzeSpendingProfile, bucketFor, weekdayNumber };
});
