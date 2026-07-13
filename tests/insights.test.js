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

function sufficientCoffeeSample() {
  return Array.from({ length: 12 }, (_, index) => expense(
    `sample-${index}`,
    index === 11 ? '2026-06-28' : `2026-06-${String(index + 1).padStart(2, '0')}`,
    index < 8 ? '09:00:00' : '',
    10 + index,
    index < 5 ? '瑞幸咖啡' : `商户${index}`,
  ));
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

test('monthly comparison reports an incomplete current month with exact coverage', () => {
  const input = analysis([], [
    { month: '2026-06', netExpense: 5000 },
    { month: '2026-07', netExpense: 3000 },
  ]);
  input.meta = { lastDate: '2026-07-13' };

  const result = Insights.analyzeSpendingProfile(input);

  assert.deepEqual(result.monthlyComparison, {
    currentMonth: '2026-07',
    previousMonth: '2026-06',
    current: 3000,
    previous: 5000,
    change: -2000,
    changeRate: -40,
    complete: false,
    coverageDays: 13,
    daysInMonth: 31,
  });
});

test('monthly comparison uses null rate when the previous net expense is zero', () => {
  const input = analysis([], [
    { month: '2026-06', netExpense: 0 },
    { month: '2026-07', netExpense: 3000 },
  ]);

  const result = Insights.analyzeSpendingProfile(input);

  assert.equal(result.monthlyComparison.changeRate, null);
});

test('monthly comparison uses null rate when the previous net expense is negative', () => {
  const input = analysis([], [
    { month: '2026-06', netExpense: -100 },
    { month: '2026-07', netExpense: 300 },
  ]);

  const result = Insights.analyzeSpendingProfile(input);

  assert.equal(result.monthlyComparison.changeRate, null);
});

test('monthly comparison skips invalid months and prefers the explicit last date', () => {
  const input = analysis([], [
    { month: '2026-05', netExpense: 100 },
    { month: 'not-a-month', netExpense: 999 },
    { month: '2026-06', netExpense: 200 },
    { month: '2026-13', netExpense: 888 },
    { month: '2026-07', netExpense: 300 },
    { month: 'broken', netExpense: 777 },
  ]);
  input.meta = { lastDate: '2026-07-31' };

  const result = Insights.analyzeSpendingProfile(input, { lastDate: '2026-07-08' });

  assert.deepEqual(result.monthlyComparison, {
    currentMonth: '2026-07',
    previousMonth: '2026-06',
    current: 300,
    previous: 200,
    change: 100,
    changeRate: 50,
    complete: false,
    coverageDays: 8,
    daysInMonth: 31,
  });
});

test('merchant profile aggregates repeated expense merchants', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('coffee-1', '2026-07-03', '09:00:00', 12, '瑞幸咖啡'),
    expense('coffee-2', '2026-07-08', '09:20:00', 18, '瑞幸咖啡'),
    expense('single', '2026-07-09', '12:00:00', 99, '只出现一次'),
    { ...expense('income', '2026-07-10', '08:00:00', 1000, '瑞幸咖啡'), flowType: 'income' },
  ]));

  assert.deepEqual(result.merchants, [{
    name: '瑞幸咖啡',
    amount: 30,
    count: 2,
    average: 15,
    latestDate: '2026-07-08',
    categoryName: '餐饮美食',
  }]);
});

test('merchant profile excludes the pending-confirmation placeholder', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('pending-1', '2026-07-03', '09:00:00', 12, '商户待确认'),
    expense('pending-2', '2026-07-08', '09:20:00', 18, '商户待确认'),
  ]));

  assert.deepEqual(result.merchants, []);
});

test('merchant profile sorts by frequency then amount and caps the list at twenty', () => {
  const transactions = [];
  for (let index = 0; index <= 20; index += 1) {
    const merchant = `商户${String(index).padStart(2, '0')}`;
    transactions.push(expense(`${index}-a`, '2026-07-01', '09:00:00', index + 1, merchant));
    transactions.push(expense(`${index}-b`, '2026-07-02', '09:00:00', index + 1, merchant));
  }
  transactions.push(expense('frequent', '2026-07-03', '09:00:00', 1, '商户00'));

  const result = Insights.analyzeSpendingProfile(analysis(transactions));

  assert.equal(result.merchants.length, 20);
  assert.equal(result.merchants[0].name, '商户00');
  assert.equal(result.merchants[1].name, '商户20');
  assert.equal(result.merchants.some((item) => item.name === '商户01'), false);
});

test('meal scenes use explicit keywords from merchant, description and search text', () => {
  const dinner = expense('dinner', '2026-07-03', '19:00:00', 40, '社区餐馆');
  dinner.searchText = '朋友 晚餐';
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('breakfast', '2026-07-01', '08:00:00', 10, '早餐铺'),
    expense('lunch', '2026-07-02', '12:00:00', 25, '园区食堂', 'food', '工作日午餐'),
    dinner,
    expense('delivery', '2026-07-04', '18:00:00', 32, '美团外卖'),
    expense('coffee', '2026-07-05', '15:00:00', 18, '瑞幸咖啡'),
  ]));

  assert.deepEqual(result.mealScenes, [
    { id: 'breakfast', label: '早餐', amount: 10, count: 1, average: 10 },
    { id: 'lunch', label: '午餐', amount: 25, count: 1, average: 25 },
    { id: 'dinner', label: '晚餐', amount: 40, count: 1, average: 40 },
    { id: 'delivery', label: '外卖', amount: 32, count: 1, average: 32 },
    { id: 'coffee', label: '咖啡饮品', amount: 18, count: 1, average: 18 },
  ]);
});

test('meal scenes cover contract keywords across merchant, description and search text', () => {
  const delivery = expense('delivery', '2026-07-04', '18:00:00', 31, '即时配送');
  delivery.searchText = '美团订单';
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('bun', '2026-07-01', '08:00:00', 8, '包子铺'),
    expense('soy-milk', '2026-07-01', '08:10:00', 4, '普通商户', 'food', '豆浆'),
    expense('canteen', '2026-07-02', '12:00:00', 20, '普通商户', 'food', '公司食堂'),
    expense('supper', '2026-07-03', '22:00:00', 25, '普通商户', 'food', '夜宵'),
    delivery,
    expense('cotti', '2026-07-05', '15:00:00', 16, '库迪'),
  ]));

  assert.deepEqual(result.mealScenes, [
    { id: 'breakfast', label: '早餐', amount: 12, count: 2, average: 6 },
    { id: 'lunch', label: '午餐', amount: 20, count: 1, average: 20 },
    { id: 'dinner', label: '晚餐', amount: 25, count: 1, average: 25 },
    { id: 'delivery', label: '外卖', amount: 31, count: 1, average: 31 },
    { id: 'coffee', label: '咖啡饮品', amount: 16, count: 1, average: 16 },
  ]);
});

test('sample sufficiency requires expense count, valid times and a 28-day span', () => {
  const result = Insights.analyzeSpendingProfile(analysis(sufficientCoffeeSample()));

  assert.deepEqual(result.sample, {
    expenseCount: 12,
    temporalCount: 8,
    spanDays: 28,
    sufficient: true,
  });
});

test('sample span includes both endpoints and counts a single day as one', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('only', '2026-06-01', '09:00:00', 10),
  ]));

  assert.equal(result.sample.spanDays, 1);
});

test('sample is insufficient when any one threshold is missed', () => {
  const tooFewExpenses = sufficientCoffeeSample().slice(0, 11);
  tooFewExpenses[10].date = '2026-06-29';
  const tooFewTimes = sufficientCoffeeSample();
  tooFewTimes[7].time = '';
  const tooShortSpan = sufficientCoffeeSample();
  tooShortSpan[11].date = '2026-06-27';

  assert.deepEqual([
    Insights.analyzeSpendingProfile(analysis(tooFewExpenses)).sample.sufficient,
    Insights.analyzeSpendingProfile(analysis(tooFewTimes)).sample.sufficient,
    Insights.analyzeSpendingProfile(analysis(tooShortSpan)).sample.sufficient,
  ], [false, false, false]);
});

test('a sufficient sample with five coffee purchases produces a coffee habit', () => {
  const result = Insights.analyzeSpendingProfile(analysis(sufficientCoffeeSample()));

  assert.deepEqual(result.habits, [{
    id: 'coffee-regular',
    label: '咖啡消费较固定',
    evidence: '咖啡消费 5 笔，共 60 元。',
  }]);
});

test('a small sample never produces a habit label', () => {
  const result = Insights.analyzeSpendingProfile(analysis(sufficientCoffeeSample().slice(0, 5)));

  assert.equal(result.sample.sufficient, false);
  assert.deepEqual(result.habits, []);
});

test('habit rules report delivery, late-night and weekend evidence from sufficient data', () => {
  const dates = [
    '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
    '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04',
    '2026-06-05', '2026-06-08', '2026-06-09', '2026-06-29',
  ];
  const transactions = dates.map((date, index) => expense(
    `habit-${index}`,
    date,
    index < 4 ? '23:00:00' : index < 8 ? '09:00:00' : '',
    index < 4 ? 100 : 10,
    index < 6 ? '美团外卖' : `其他商户${index}`,
  ));

  const result = Insights.analyzeSpendingProfile(analysis(transactions));

  assert.deepEqual(result.habits, [
    { id: 'delivery-frequent', label: '外卖消费较频繁', evidence: '外卖消费 6 笔，共 420 元。' },
    { id: 'late-night-spending', label: '存在深夜消费', evidence: '深夜消费 4 笔，共 400 元。' },
    {
      id: 'weekend-premium',
      label: '周末客单价更高',
      evidence: '周末消费 4 笔，共 400 元；工作日消费 8 笔，共 80 元。',
    },
  ]);
});

test('an incomplete month gets only a partial-month reminder and no month-change claim', () => {
  const input = analysis([], [
    { month: '2026-06', netExpense: 5000 },
    { month: '2026-07', netExpense: 3000 },
  ]);
  input.meta = { lastDate: '2026-07-13' };

  const result = Insights.analyzeSpendingProfile(input);

  assert.deepEqual(result.recommendations, [{
    id: 'partial-month',
    tone: 'neutral',
    title: '本月数据尚未完整',
    evidence: '2026-07 仅覆盖 13/31 天。',
    impact: '当前金额不适合直接和完整月份比较。',
    action: '等本月数据完整后，再判断环比变化。',
  }]);
  assert.equal(result.recommendations.some((item) => item.id === 'month-change'), false);
});

test('month-change requires a complete month and at least fifteen percent change', () => {
  const changed = Insights.analyzeSpendingProfile(analysis([], [
    { month: '2026-06', netExpense: 5000 },
    { month: '2026-07', netExpense: 4000 },
  ]));
  const stable = Insights.analyzeSpendingProfile(analysis([], [
    { month: '2026-06', netExpense: 5000 },
    { month: '2026-07', netExpense: 4500 },
  ]));

  assert.deepEqual(changed.recommendations, [{
    id: 'month-change',
    tone: 'positive',
    title: '本月净消费环比下降 20%',
    evidence: '2026-07 为 4000 元，2026-06 为 5000 元，变化 -1000 元。',
    impact: '完整月份的消费较上月明显下降。',
    action: '回看减少最多的消费场景，确认哪些变化值得保持。',
  }]);
  assert.deepEqual(stable.recommendations, []);
});

test('sufficient samples can recommend reviewing late-night and top-merchant spending', () => {
  const transactions = sufficientCoffeeSample();
  transactions.slice(0, 4).forEach((item) => { item.time = '23:00:00'; });

  const result = Insights.analyzeSpendingProfile(analysis(transactions));

  assert.deepEqual(result.recommendations, [
    {
      id: 'late-night',
      tone: 'attention',
      title: '深夜消费出现较频繁',
      evidence: '深夜消费 4 笔，共 46 元。',
      impact: '深夜时段的消费更容易缺少当下比较。',
      action: '下次深夜消费前先停一分钟，确认是否确有需要。',
    },
    {
      id: 'top-merchant',
      tone: 'neutral',
      title: '瑞幸咖啡是高频消费商户',
      evidence: '瑞幸咖啡共 5 笔，60 元，平均 12 元。',
      impact: '固定商户的小额多次消费会逐步累积。',
      action: '回看这些消费是否都符合当时的实际需要。',
    },
  ]);
});
