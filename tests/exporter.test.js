const test = require('node:test');
const assert = require('node:assert/strict');
const Exporter = require('../src/exporter.js');

const analysis = {
  meta: { dateRange: '2026-06-01 — 2026-07-13', coverageDays: 43 },
  summary: { totalIncome: 9000, netExpense: 3000, cashBalance: 6000, savingsRate: 66.7 },
  monthly: [{ month: '2026-07', income: 9000, grossExpense: 3100, refunds: 100, netExpense: 3000, balance: 6000 }],
  categories: [{ name: '餐饮美食', amount: 1000, share: 33.3, count: 20, average: 50, needType: 'essential' }],
  transactions: [{
    date: '2026-07-01', time: '12:00:00', flowType: 'expense', merchant: '=HYPERLINK("bad")',
    categoryName: '餐饮美食', source: 'alipay', amount: 50, ruleId: 'food', confidence: 0.9, description: '午餐',
  }],
  quality: { rawRecords: 1, validRecords: 1, ignoredRecords: 0, matchedPairs: 0, ambiguousMatches: 0, warningCount: 0 },
};

test('workbook data contains the six promised Chinese sheet names', () => {
  const result = Exporter.buildWorkbookData(analysis, { merchants: [], habits: [] }, { total: 0 });
  assert.deepEqual(Object.keys(result), ['总览', '月度趋势', '分类分析', '商家分析', '交易明细', '数据质量']);
});

test('transaction cells that look like formulas are stored as text', () => {
  const result = Exporter.buildWorkbookData(analysis, { merchants: [], habits: [] }, { total: 0 });
  assert.equal(result['交易明细'][1][3], '\'=HYPERLINK("bad")');
});

test('empty analysis still creates six header-only sheets and never exports raw objects', () => {
  const result = Exporter.buildWorkbookData({ meta: {}, summary: {}, monthly: [], categories: [], transactions: [], quality: {} });
  assert.equal(Object.keys(result).length, 6);
  assert.equal(result['交易明细'].length, 1);
  assert.doesNotMatch(JSON.stringify(result), /"raw"/u);
});

test('export refuses to run without the local SheetJS runtime', () => {
  assert.throws(() => Exporter.exportWorkbook(analysis, {}, {}, null, 'test.xlsx'), /Excel 导出组件未加载/u);
});
