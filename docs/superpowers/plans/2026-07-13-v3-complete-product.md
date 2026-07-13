# 「钱都去哪了」V3 Complete Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing local-first bill analyzer with explainable spending portraits, monthly comparison, session-only budgets, Excel export, a fresh responsive UI, and a verified single-HTML offline deliverable.

**Architecture:** Keep `src/core.js` as the stable parsing, classification, reconciliation, and base-analysis kernel. Add three small UMD modules for insights, budget, and export; let `src/app.js` orchestrate files and DOM only. Build scripts load the modules in a fixed order and continue to emit a network-isolated single HTML file.

**Tech Stack:** Semantic HTML5, CSS3, browser JavaScript with UMD modules, Node.js `node:test`, Apache ECharts 6.1.0, Papa Parse 5.5.4, SheetJS CE 0.20.3, PDF.js 6.1.200, GitHub Actions.

**Design source:** `docs/superpowers/specs/2026-07-13-v3-upgrade-design.md`

---

## File map

### Create

- `src/insights.js` — pure portrait, time, merchant, monthly-comparison, habit, and recommendation calculations.
- `src/budget.js` — budget validation, session storage, progress, and month-end projection.
- `src/exporter.js` — safe workbook rows and SheetJS download orchestration.
- `tests/insights.test.js` — portrait thresholds, time buckets, incomplete months, and evidence tests.
- `tests/budget.test.js` — storage, validation, progress, and forecast tests.
- `tests/exporter.test.js` — six-sheet schema and spreadsheet-injection protection tests.
- `.github/workflows/ci.yml` — Node test and deterministic build checks.
- `SECURITY.md` — privacy/security model and vulnerability reporting.
- `CHANGELOG.md` — V3 user-visible changes.
- `CONTRIBUTING.md` — safe fixture, test, and build workflow.

### Modify

- `index.html` — fresh semantic shell, batch inputs, report navigation, portrait, budget, and export controls.
- `styles.css` — new token system, light/dark themes, responsive layout, accessible states, and print rules.
- `src/app.js` — file queues, staged progress, new view rendering, theme, budget, and export actions.
- `scripts/build-static.js` — include the three new modules.
- `scripts/build-offline.js` — inline the three modules before `src/app.js` and preserve the offline CSP.
- `tests/structure.test.js` — enforce module order, semantic sections, privacy, responsive hooks, and offline content.
- `package.json` — version and focused test commands.
- `README.md` — V3 use, export, privacy, and sharing instructions.

### Preserve without redesign

- `src/core.js` — only change if a failing regression test proves a missing stable primitive.
- `tests/core.test.js` and `tests/parsers.test.js` — remain the 33-test parser/finance regression baseline.
- `assets/brands/*.svg` and `vendor/*` — no new runtime dependency or CDN.

## Task 1: Add the spending-profile module contract

**Files:**
- Create: `tests/insights.test.js`
- Create: `src/insights.js`

- [ ] **Step 1: Write failing tests for time buckets, weekday/weekend, and missing-time handling**

Create `tests/insights.test.js` with these fixtures and assertions:

```js
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
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test tests/insights.test.js`
Expected: FAIL with `Cannot find module '../src/insights.js'`.

- [ ] **Step 3: Implement the UMD shell and profile aggregation**

Create `src/insights.js`. Export exactly this public API:

```js
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
  const roundOne = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
  const expensesOf = (analysis) => (analysis.transactions || []).filter((item) => item.flowType === 'expense');

  function weekdayNumber(date) {
    if (!/^20\d{2}-\d{2}-\d{2}$/u.test(date || '')) return null;
    const [year, month, day] = date.split('-').map(Number);
    const nativeDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
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
      weekday: aggregate(expenses.filter((item) => weekdayNumber(item.date) <= 5)),
      weekend: aggregate(expenses.filter((item) => weekdayNumber(item.date) >= 6)),
    };
  }

  function buildTimeProfile(expenses) {
    const cells = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      TIME_BUCKETS.forEach((bucket) => {
        const matches = expenses.filter((item) => weekdayNumber(item.date) === weekday && bucketFor(item.time)?.id === bucket.id);
        cells.push({ weekday, bucket: bucket.id, ...aggregate(matches) });
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
```

- [ ] **Step 4: Run the focused and full baseline tests**

Run: `node --test tests/insights.test.js`
Expected: 2 tests PASS.

Run: `npm test`
Expected: 48 tests PASS.

- [ ] **Step 5: Commit only the new module and tests**

```bash
git add src/insights.js tests/insights.test.js
git commit -m "feat: add spending time profile"
```

## Task 2: Add monthly comparison, merchants, meal scenes, and habit thresholds

**Files:**
- Modify: `tests/insights.test.js`
- Modify: `src/insights.js`

- [ ] **Step 1: Add failing tests for comparison completeness and profile evidence**

Append these tests:

```js
test('monthly comparison marks a partial latest month and calculates change', () => {
  const result = Insights.analyzeSpendingProfile(analysis([], [
    { month: '2026-06', income: 9000, netExpense: 5000, balance: 4000 },
    { month: '2026-07', income: 9000, netExpense: 3000, balance: 6000 },
  ]), { lastDate: '2026-07-13' });
  assert.deepEqual(result.monthlyComparison, {
    currentMonth: '2026-07', previousMonth: '2026-06', current: 3000,
    previous: 5000, change: -2000, changeRate: -40, complete: false,
    coverageDays: 13, daysInMonth: 31,
  });
});

test('merchant ranking includes average and latest date', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('a', '2026-07-01', '10:00:00', 12, '瑞幸咖啡'),
    expense('b', '2026-07-08', '10:00:00', 18, '瑞幸咖啡'),
  ]));
  assert.deepEqual(result.merchants[0], {
    name: '瑞幸咖啡', amount: 30, count: 2, average: 15,
    latestDate: '2026-07-08', categoryName: '餐饮美食',
  });
});

test('habit tags require enough history and expose the evidence sentence', () => {
  const rows = Array.from({ length: 12 }, (_, index) => expense(
    `row-${index}`, index < 6 ? `2026-06-${String(index + 1).padStart(2, '0')}` : `2026-07-${String(index + 1).padStart(2, '0')}`,
    '09:00:00', 15, index < 5 ? '瑞幸咖啡' : '早餐店', 'food', index < 5 ? '咖啡' : '早餐',
  ));
  const result = Insights.analyzeSpendingProfile(analysis(rows));
  assert.equal(result.habits.some((item) => item.id === 'coffee-regular'), true);
  assert.match(result.habits.find((item) => item.id === 'coffee-regular').evidence, /5 笔/);
});

test('small samples do not produce personality-like habit labels', () => {
  const result = Insights.analyzeSpendingProfile(analysis([
    expense('a', '2026-07-01', '23:00:00', 20, '便利店'),
  ]));
  assert.deepEqual(result.habits, []);
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing values**

Run: `node --test tests/insights.test.js`
Expected: 4 new tests FAIL because the initial empty values are still returned.

- [ ] **Step 3: Implement the new aggregators and call them from `analyzeSpendingProfile`**

Add these functions inside the factory:

```js
function daysInMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

function buildMonthlyComparison(analysis, options) {
  const months = (analysis.monthly || []).filter((item) => /^20\d{2}-\d{2}$/u.test(item.month));
  if (months.length < 2) return null;
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  const lastDate = options.lastDate || analysis.meta?.lastDate || '';
  const coverageDays = lastDate.startsWith(current.month) ? Number(lastDate.slice(8, 10)) : daysInMonth(current.month);
  const change = roundMoney(current.netExpense - previous.netExpense);
  return {
    currentMonth: current.month,
    previousMonth: previous.month,
    current: current.netExpense,
    previous: previous.netExpense,
    change,
    changeRate: previous.netExpense > 0 ? roundOne((change / previous.netExpense) * 100) : null,
    complete: coverageDays === daysInMonth(current.month),
    coverageDays,
    daysInMonth: daysInMonth(current.month),
  };
}

function buildMerchants(expenses) {
  const groups = new Map();
  expenses.forEach((item) => {
    const name = item.merchant || '商户待确认';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  });
  return Array.from(groups.entries()).filter(([name, items]) => name !== '商户待确认' && items.length >= 2).map(([name, items]) => {
    const summary = aggregate(items);
    return {
      name, ...summary,
      latestDate: items.map((item) => item.date).sort().at(-1) || '',
      categoryName: items[0].categoryName || '待确认',
    };
  }).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 20);
}

function buildMealScenes(expenses) {
  const definitions = [
    ['breakfast', '早餐', /早餐|包子|豆浆|胡辣汤/iu],
    ['lunch', '午餐', /午餐|工作餐|食堂/iu],
    ['dinner', '晚餐', /晚餐|夜宵/iu],
    ['delivery', '外卖', /外卖|美团|饿了么/iu],
    ['coffee', '咖啡饮品', /咖啡|瑞幸|星巴克|库迪/iu],
  ];
  return definitions.map(([id, label, pattern]) => {
    const items = expenses.filter((item) => pattern.test(`${item.merchant || ''} ${item.description || ''} ${item.searchText || ''}`));
    return { id, label, ...aggregate(items) };
  }).filter((item) => item.count > 0);
}

function buildSample(expenses) {
  const dated = expenses.map((item) => item.date).filter((date) => /^20\d{2}-\d{2}-\d{2}$/u.test(date)).sort();
  const temporalCount = expenses.filter((item) => bucketFor(item.time)).length;
  const first = dated[0] ? Date.parse(`${dated[0]}T00:00:00Z`) : 0;
  const last = dated.length ? Date.parse(`${dated.at(-1)}T00:00:00Z`) : 0;
  const spanDays = first && last ? Math.floor((last - first) / 86400000) + 1 : 0;
  return {
    expenseCount: expenses.length,
    temporalCount,
    spanDays,
    sufficient: expenses.length >= 12 && temporalCount >= 8 && spanDays >= 28,
  };
}

function buildHabits(expenses, weekPattern, timeProfile, mealScenes, sample) {
  const habits = [];
  if (!sample.sufficient) return habits;
  const coffee = mealScenes.find((item) => item.id === 'coffee');
  const delivery = mealScenes.find((item) => item.id === 'delivery');
  const lateNight = timeProfile.buckets.find((item) => item.id === 'late-night');
  if (coffee?.count >= 5) habits.push({ id: 'coffee-regular', label: '咖啡消费较稳定', evidence: `${coffee.count} 笔，共 ¥${coffee.amount}` });
  if (delivery?.count >= 6) habits.push({ id: 'delivery-regular', label: '外卖出现较频繁', evidence: `${delivery.count} 笔，共 ¥${delivery.amount}` });
  if (lateNight?.count >= 4) habits.push({ id: 'late-night-repeat', label: '深夜消费重复出现', evidence: `${lateNight.count} 笔，共 ¥${lateNight.amount}` });
  if (weekPattern.weekend.count >= 4 && weekPattern.weekend.average > weekPattern.weekday.average * 1.25) {
    habits.push({ id: 'weekend-higher', label: '周末客单价更高', evidence: `周末平均 ¥${weekPattern.weekend.average}，工作日平均 ¥${weekPattern.weekday.average}` });
  }
  return habits;
}
```

Replace the return body of `analyzeSpendingProfile` with:

```js
function analyzeSpendingProfile(analysis, options = {}) {
  const expenses = expensesOf(analysis);
  const sample = buildSample(expenses);
  const weekPattern = buildWeekPattern(expenses);
  const timeProfile = buildTimeProfile(expenses);
  const mealScenes = buildMealScenes(expenses);
  return {
    sample,
    weekPattern,
    timeProfile,
    monthlyComparison: buildMonthlyComparison(analysis, options),
    merchants: buildMerchants(expenses),
    mealScenes,
    habits: buildHabits(expenses, weekPattern, timeProfile, mealScenes, sample),
    recommendations: buildProfileRecommendations(analysis, {
      sample, weekPattern, timeProfile, mealScenes,
      monthlyComparison: buildMonthlyComparison(analysis, options),
      merchants: buildMerchants(expenses),
    }),
  };
}
```

Add this deterministic recommendation builder. It never emits a month-change conclusion for a partial latest month:

```js
function buildProfileRecommendations(analysis, profile) {
  const result = [];
  const comparison = profile.monthlyComparison;
  const lateNight = profile.timeProfile.buckets.find((item) => item.id === 'late-night');
  const topMerchant = profile.merchants[0];
  if (comparison && !comparison.complete) {
    result.push({
      id: 'partial-month', tone: 'neutral', title: '本月数据仍在累积',
      evidence: `当前覆盖 ${comparison.coverageDays}/${comparison.daysInMonth} 天`,
      impact: '直接与完整上月比较可能放大或缩小真实变化。',
      action: '先观察消费节奏，月底再确认环比结论。',
    });
  }
  if (comparison?.complete && comparison.changeRate != null && Math.abs(comparison.changeRate) >= 15) {
    result.push({
      id: 'month-change', tone: comparison.change > 0 ? 'attention' : 'positive',
      title: comparison.change > 0 ? '本月净消费明显增加' : '本月净消费明显下降',
      evidence: `较上月${comparison.change > 0 ? '增加' : '减少'} ¥${Math.abs(comparison.change)}（${Math.abs(comparison.changeRate)}%）`,
      impact: '持续变化会直接影响当月现金结余。',
      action: '结合变化贡献最大的分类逐笔核对原因。',
    });
  }
  if (profile.sample.sufficient && lateNight?.count >= 4) {
    result.push({
      id: 'late-night', tone: 'neutral', title: '深夜消费重复出现',
      evidence: `${lateNight.count} 笔，共 ¥${lateNight.amount}`,
      impact: '集中时段的小额消费容易在月度汇总中被忽略。',
      action: '回看发生最多的星期和商家，判断是否需要设置提醒。',
    });
  }
  if (profile.sample.sufficient && topMerchant?.count >= 5) {
    result.push({
      id: 'top-merchant', tone: 'neutral', title: `${topMerchant.name}出现最频繁`,
      evidence: `${topMerchant.count} 笔，共 ¥${topMerchant.amount}，平均 ¥${topMerchant.average}`,
      impact: '高频项目的小幅调整通常比零散削减更容易执行。',
      action: '确认频率是否符合当前优先级，再决定保留或减少一次。',
    });
  }
  return result.slice(0, 4);
}
```

- [ ] **Step 4: Run insight and baseline tests**

Run: `node --test tests/insights.test.js`
Expected: all insight tests PASS.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit the completed portrait calculations**

```bash
git add src/insights.js tests/insights.test.js
git commit -m "feat: add explainable spending portrait"
```

## Task 3: Add session-only budget calculation

**Files:**
- Create: `tests/budget.test.js`
- Create: `src/budget.js`

- [ ] **Step 1: Write failing tests for validation, storage failures, and forecast**

Create `tests/budget.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Budget = require('../src/budget.js');

test('normalization keeps non-negative totals and category values', () => {
  assert.deepEqual(Budget.normalizeBudget({ total: '7000', categories: { food: '1500', shopping: '-2' } }), {
    total: 7000, categories: { food: 1500, shopping: 0 },
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
  assert.equal(status.categories.food.spent, 900);
});

test('storage helpers fail closed without throwing', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(Budget.loadBudget(storage), { total: 0, categories: {} });
  assert.equal(Budget.saveBudget({ total: 1 }, storage), false);
  assert.equal(Budget.clearBudget(storage), false);
});

test('missing analysis dates do not project unrelated transactions', () => {
  const status = Budget.calculateBudget({ meta: { lastDate: '' }, transactions: [
    { date: '2026-07-01', flowType: 'expense', amount: 500, categoryId: 'food' },
  ] }, { total: 1000, categories: {} });
  assert.equal(status.month, '');
  assert.equal(status.spent, 0);
  assert.equal(status.projected, 0);
});
```

- [ ] **Step 2: Run tests and verify the missing module failure**

Run: `node --test tests/budget.test.js`
Expected: FAIL with `Cannot find module '../src/budget.js'`.

- [ ] **Step 3: Implement the budget UMD module**

Use this UMD opening, then add the implementation below inside its factory. It chooses `analysis.meta.lastDate.slice(0, 7)` as the active month, subtracts refunds from expenses, clamps progress to a non-negative whole percentage, and computes the historical-month projection from the latest bill date rather than the system clock:

```js
(function initBillAnalyzerBudget(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerBudget() {
  'use strict';
```

```js
const STORAGE_KEY = 'money-where-budget-v3';
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const nonNegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, money(value)) : 0;

function normalizeBudget(input = {}) {
  return {
    total: nonNegative(input.total),
    categories: Object.fromEntries(Object.entries(input.categories || {}).map(([id, value]) => [id, nonNegative(value)])),
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  return typeof window !== 'undefined' ? window.sessionStorage : null;
}

function loadBudget(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(STORAGE_KEY);
    return raw ? normalizeBudget(JSON.parse(raw)) : normalizeBudget();
  } catch (_) {
    return normalizeBudget();
  }
}

function saveBudget(budget, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(normalizeBudget(budget)));
    return true;
  } catch (_) {
    return false;
  }
}

function clearBudget(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.removeItem(STORAGE_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

function calculateBudget(analysis, input) {
  const budget = normalizeBudget(input);
  const lastDate = analysis.meta?.lastDate || '';
  const month = lastDate.slice(0, 7);
  const elapsedDays = Number(lastDate.slice(8, 10)) || 1;
  const [year, number] = month.split('-').map(Number);
  const monthDays = year && number ? new Date(Date.UTC(year, number, 0)).getUTCDate() : elapsedDays;
  const rows = month ? (analysis.transactions || []).filter((item) => item.date?.startsWith(month)) : [];
  const spent = money(rows.reduce((sum, item) => sum + (item.flowType === 'expense' ? item.amount : item.flowType === 'refund' ? -item.amount : 0), 0));
  const categoryIds = new Set([...Object.keys(budget.categories), ...rows.map((item) => item.categoryId).filter(Boolean)]);
  const categories = Object.fromEntries(Array.from(categoryIds).map((id) => {
    const categorySpent = money(rows.reduce((sum, item) => sum + (item.categoryId === id ? (item.flowType === 'expense' ? item.amount : item.flowType === 'refund' ? -item.amount : 0) : 0), 0));
    const limit = budget.categories[id] || 0;
    return [id, { limit, spent: categorySpent, remaining: money(limit - categorySpent), progress: limit > 0 ? Math.round((categorySpent / limit) * 100) : null }];
  }));
  return {
    month, total: budget.total, spent,
    remaining: money(budget.total - spent),
    progress: budget.total > 0 ? Math.max(0, Math.round((spent / budget.total) * 100)) : null,
    projected: money((spent / elapsedDays) * monthDays),
    categories,
  };
}
```

Export this exact API:

```js
return {
  STORAGE_KEY: 'money-where-budget-v3',
  calculateBudget,
  clearBudget,
  loadBudget,
  normalizeBudget,
  saveBudget,
};
});
```

The storage functions must wrap every access in `try/catch`, default to `window.sessionStorage` only when `window` exists, and return `false` rather than throwing when storage is unavailable.

- [ ] **Step 4: Run budget and full tests**

Run: `node --test tests/budget.test.js`
Expected: 4 tests PASS.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit the budget module**

```bash
git add src/budget.js tests/budget.test.js
git commit -m "feat: add session-only budgets"
```

## Task 4: Add six-sheet safe Excel export

**Files:**
- Create: `tests/exporter.test.js`
- Create: `src/exporter.js`

- [ ] **Step 1: Write failing tests for sheet schema and formula neutralization**

Create `tests/exporter.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Exporter = require('../src/exporter.js');

const analysis = {
  meta: { dateRange: '2026-06-01 — 2026-07-13', coverageDays: 43 },
  summary: { totalIncome: 9000, netExpense: 3000, cashBalance: 6000, savingsRate: 66.7 },
  monthly: [{ month: '2026-07', income: 9000, grossExpense: 3100, refunds: 100, netExpense: 3000, balance: 6000 }],
  categories: [{ name: '餐饮美食', amount: 1000, share: 33.3, count: 20, average: 50, needType: 'essential' }],
  transactions: [{ date: '2026-07-01', time: '12:00:00', flowType: 'expense', merchant: '=HYPERLINK("bad")', categoryName: '餐饮美食', source: 'alipay', amount: 50, ruleId: 'food', confidence: 0.9, description: '午餐' }],
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
```

- [ ] **Step 2: Run tests and verify the missing module failure**

Run: `node --test tests/exporter.test.js`
Expected: FAIL with `Cannot find module '../src/exporter.js'`.

- [ ] **Step 3: Implement pure workbook rows and browser download**

Open the exporter with this UMD shell:

```js
(function initBillAnalyzerExporter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerExporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerExporter() {
  'use strict';
```

Define `SHEET_NAMES` as `['总览', '月度趋势', '分类分析', '商家分析', '交易明细', '数据质量']`. Use this formula-neutralizer and row mapper:

```js
const SHEET_NAMES = ['总览', '月度趋势', '分类分析', '商家分析', '交易明细', '数据质量'];
function safeCell(value) {
  if (typeof value !== 'string') return value;
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '');
  return /^\s*[=+\-@]/u.test(clean) ? `'${clean}` : clean;
}
const safeRow = (row) => row.map(safeCell);

function buildWorkbookData(analysis, insights = {}, budgetStatus = {}) {
  const previousByMonth = new Map();
  const monthlyRows = (analysis.monthly || []).map((item) => {
    const previous = previousByMonth.get('latest');
    const rate = previous?.netExpense > 0 ? Math.round(((item.netExpense - previous.netExpense) / previous.netExpense) * 1000) / 10 : null;
    previousByMonth.set('latest', item);
    return [item.month, item.income, item.grossExpense, item.refunds, item.netExpense, item.balance, rate];
  });
  return {
    总览: [HEADERS.总览, ...[
      ['数据范围', analysis.meta?.dateRange || ''], ['覆盖天数', analysis.meta?.coverageDays || 0],
      ['真实收入', analysis.summary?.totalIncome || 0], ['净消费', analysis.summary?.netExpense || 0],
      ['现金结余', analysis.summary?.cashBalance || 0], ['结余率', analysis.summary?.savingsRate],
      ['预算', budgetStatus.total || 0], ['预算剩余', budgetStatus.remaining ?? null],
    ].map(safeRow)],
    月度趋势: [HEADERS.月度趋势, ...monthlyRows.map(safeRow)],
    分类分析: [HEADERS.分类分析, ...(analysis.categories || []).map((item) => safeRow([item.name, item.amount, item.share, item.count, item.average, item.needType]))],
    商家分析: [HEADERS.商家分析, ...(insights.merchants || []).map((item) => safeRow([item.name, item.count, item.amount, item.average, item.latestDate, item.categoryName]))],
    交易明细: [HEADERS.交易明细, ...(analysis.transactions || []).map((item) => safeRow([item.date, item.time, item.flowType, item.merchant, item.categoryName, item.source, item.amount, item.description, item.ruleId, item.confidence]))],
    数据质量: [HEADERS.数据质量, ...[
      ['原始记录', analysis.quality?.rawRecords || 0, '导入文件中的交易行'],
      ['有效记录', analysis.quality?.validRecords || 0, '完成过滤和去重后'],
      ['忽略记录', analysis.quality?.ignoredRecords || 0, '关闭、失败或退回等状态'],
      ['跨来源关联', analysis.quality?.matchedPairs || 0, '银行卡与支付平台唯一匹配'],
      ['歧义候选', analysis.quality?.ambiguousMatches || 0, '为避免误删而保留'],
      ['字段警告', analysis.quality?.warningCount || 0, '缺失状态或字段等提示'],
    ].map(safeRow)],
  };
}
```

Place these exact headers immediately after `SHEET_NAMES` and before `buildWorkbookData`:

```js
const HEADERS = {
  总览: ['指标', '数值'],
  月度趋势: ['月份', '收入', '总消费', '退款', '净消费', '结余', '净消费环比'],
  分类分析: ['分类', '金额', '占比', '笔数', '客单价', '消费属性'],
  商家分析: ['商家', '次数', '总金额', '客单价', '最近日期', '主要分类'],
  交易明细: ['日期', '时间', '资金流', '商家', '分类', '来源', '金额', '说明', '规则', '置信度'],
  数据质量: ['指标', '数量', '说明'],
};
```

Add this exact browser wrapper:

```js
function exportWorkbook(analysis, insights, budgetStatus, xlsx, filename) {
  if (!xlsx?.utils?.book_new || !xlsx?.writeFile) throw new Error('Excel 导出组件未加载。');
  const data = buildWorkbookData(analysis, insights, budgetStatus);
  const workbook = xlsx.utils.book_new();
  SHEET_NAMES.forEach((name) => xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(data[name]), name));
  xlsx.writeFile(workbook, filename, { compression: true });
}

return { SHEET_NAMES, buildWorkbookData, exportWorkbook, safeCell };
});
```

- [ ] **Step 4: Run exporter and full tests**

Run: `node --test tests/exporter.test.js`
Expected: 3 tests PASS.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit the exporter**

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: add safe Excel export"
```

## Task 5: Lock the V3 semantic UI and build contracts

**Files:**
- Modify: `tests/structure.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add failing structure tests for modules, navigation, budget, portrait, and theme**

Append a test that asserts:

```js
test('V3 page exposes fresh report navigation and product actions', () => {
  const html = read('index.html');
  assert.match(html, /id="theme-button"/);
  assert.match(html, /id="export-button"/);
  assert.match(html, /id="report-tabs"/);
  assert.match(html, /data-report-tab="overview"/);
  assert.match(html, /data-report-tab="portrait"/);
  assert.match(html, /data-report-tab="details"/);
  assert.match(html, /id="budget-form"/);
  assert.match(html, /id="budget-categories"/);
  assert.match(html, /id="time-heatmap"/);
  assert.match(html, /id="merchant-ranking"/);
  assert.match(html, /id="profile-advice"/);
  assert.match(html, /type="file"[^>]+multiple/gu);
});

test('V3 runtime modules load before the application in every build', () => {
  const html = read('index.html');
  const expected = ['src/core.js', 'src/insights.js', 'src/budget.js', 'src/exporter.js', 'src/app.js'];
  const positions = expected.map((file) => html.indexOf(file));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
  const staticBuilder = read('scripts/build-static.js');
  const offlineBuilder = read('scripts/build-offline.js');
  expected.forEach((file) => {
    assert.match(staticBuilder, new RegExp(file.replace('.', '\\.')));
    assert.match(offlineBuilder, new RegExp(file.replace('.', '\\.')));
  });
});
```

- [ ] **Step 2: Update package metadata and focused scripts**

Set version to `3.0.0` and add:

```json
"test:features": "node --test tests/insights.test.js tests/budget.test.js tests/exporter.test.js"
```

- [ ] **Step 3: Run the structure test and confirm V3 markers are absent**

Run: `npm run test:structure`
Expected: the two new V3 tests FAIL.

- [ ] **Step 4: Do not commit this red test separately**

Keep the tests unstaged until Tasks 6–10 satisfy them; this prevents a permanently broken intermediate branch.

## Task 6: Replace the page shell with the approved fresh information architecture

**Files:**
- Modify: `index.html`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Add V3 scripts in dependency order**

The bottom of `index.html` must contain:

```html
<script defer src="vendor/echarts.min.js"></script>
<script defer src="vendor/papaparse.min.js"></script>
<script defer src="vendor/xlsx.full.min.js"></script>
<script defer src="vendor/pdf.bundle.min.js"></script>
<script defer src="src/core.js"></script>
<script defer src="src/insights.js"></script>
<script defer src="src/budget.js"></script>
<script defer src="src/exporter.js"></script>
<script defer src="src/app.js"></script>
```

- [ ] **Step 2: Rebuild the header and upload form with stable IDs**

Keep the existing CSP and `main-content`. Add `theme-button` in the header. Keep three source-labelled inputs and add `multiple` to each input. Add `file-progress-list` below the live progress region. Retain the bank password field, brand SVG paths, `sample-button`, `analyze-button`, and per-source clear buttons so parsing regressions remain isolated from the redesign.

- [ ] **Step 3: Build the report navigation and three panels**

Use native buttons inside `#report-tabs`, each with `aria-controls`, and these stable targets:

```html
<nav id="report-tabs" class="report-tabs" aria-label="报告视图">
  <button type="button" class="report-tab is-active" data-report-tab="overview" aria-selected="true" aria-controls="overview-panel">总览</button>
  <button type="button" class="report-tab" data-report-tab="portrait" aria-selected="false" aria-controls="portrait-panel">消费画像</button>
  <button type="button" class="report-tab" data-report-tab="details" aria-selected="false" aria-controls="details-panel">交易明细</button>
</nav>
```

`#overview-panel` must contain the four existing metric IDs plus `metric-budget`, `month-comparison`, `category-chart`, `chart-summary`, `trend-chart`, `need-structure`, `change-drivers`, and `insight-list`.

`#portrait-panel` must contain `portrait-tags`, `week-pattern`, `time-heatmap`, `time-summary`, `meal-scenes`, `merchant-ranking`, and `profile-advice`.

`#details-panel` must retain `quality-strip`, all four filter IDs, `transaction-body`, and `mobile-transactions`.

- [ ] **Step 4: Add the budget form and export confirmation**

Add a visible budget panel rather than a modal:

```html
<form id="budget-form" class="budget-form">
  <label for="budget-total">每月总预算</label>
  <div class="budget-entry">
    <input id="budget-total" name="budget-total" type="number" inputmode="decimal" min="0" step="100" placeholder="例如 7000">
    <button class="button button-primary" type="submit">保存本次预算</button>
    <button id="budget-clear" class="button button-quiet" type="button">清除</button>
  </div>
  <fieldset>
    <legend>分类预算</legend>
    <div id="budget-categories" class="budget-categories"></div>
  </fieldset>
  <p id="budget-feedback" role="status" aria-live="polite">预算只保存在当前浏览器会话。</p>
</form>
```

Add `export-button` near the report heading. The click handler will use a native `window.confirm`, so no hidden dialog markup is needed.

- [ ] **Step 5: Run semantic structure tests**

Run: `npm run test:structure`
Expected: the semantic UI test PASS; the build-order test still FAIL until Task 10.

- [ ] **Step 6: Commit the semantic page and red build test together only after the page test passes**

```bash
git add index.html tests/structure.test.js package.json
git commit -m "feat: add V3 report information architecture"
```

## Task 7: Implement the fresh light/dark responsive design

**Files:**
- Modify: `styles.css`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Add a structure test for responsive and accessibility hooks**

Assert that `styles.css` contains `color-scheme: light`, `[data-theme="dark"]`, `@media (max-width: 767px)`, `@media (max-width: 430px)`, `@media (prefers-reduced-motion: reduce)`, `:focus-visible`, and `.mobile-transactions`.

- [ ] **Step 2: Replace the old beige editorial tokens**

Start the stylesheet with this token contract:

```css
:root {
  color-scheme: light;
  --bg: #f5faf8;
  --surface: #ffffff;
  --surface-soft: #edf7f3;
  --text: #17332b;
  --muted: #5f716b;
  --line: #d9e7e1;
  --primary: #18765a;
  --primary-strong: #0f5c45;
  --accent: #2f7fa0;
  --warning: #a35d20;
  --danger: #a33f48;
  --shadow: 0 14px 40px rgba(23, 51, 43, 0.08);
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --content: 1200px;
  --font-body: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-number: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1d19;
  --surface: #162722;
  --surface-soft: #1b312a;
  --text: #ecf7f2;
  --muted: #adbfb8;
  --line: #2b443b;
  --primary: #63c6a2;
  --primary-strong: #8fdbbe;
  --accent: #74bad5;
  --warning: #e5a765;
  --danger: #ee8c94;
  --shadow: 0 16px 44px rgba(0, 0, 0, 0.24);
}
```

- [ ] **Step 3: Implement mobile-first geometry**

Base styles use one column, 16px body text, 16px page padding, 44px controls, no fixed heights, and `min-width: 0` on every grid child. At `768px`, metric cards become two columns and report grids become two columns only when each chart retains at least 320px. At `1024px`, the four metrics become four columns. At `430px`, action groups stack and transaction tables stay hidden in favor of `.mobile-transactions`.

Use `overflow-wrap: anywhere` for filenames and merchant text. Use `overflow-x: auto` only on `.table-wrap`; no other page region may create horizontal scrolling.

- [ ] **Step 4: Implement theme-aware ECharts host classes and print rules**

Give charts a minimum block size of 280px on desktop and 240px on mobile. Hide navigation, upload, theme, export, budget controls, and tabs in print; print all three report panels as visible blocks.

- [ ] **Step 5: Implement focus and motion rules**

```css
:where(button, input, select, a):focus-visible {
  outline: 3px solid color-mix(in srgb, var(--primary) 42%, transparent);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: Run structure tests and commit**

Run: `npm run test:structure`
Expected: responsive hooks test PASS.

```bash
git add styles.css tests/structure.test.js
git commit -m "feat: apply fresh responsive visual system"
```

## Task 8: Upgrade file selection to sequential multi-file queues

**Files:**
- Modify: `src/app.js`
- Modify: `tests/structure.test.js`

- [ ] **Step 1: Strengthen the existing upload-budget structure test**

Require `STATE.files` arrays, `selectedEntries()`, a `for (const entry of selectedEntries())` loop, a visible `file-progress-list`, and the unchanged 40 MiB total limit.

- [ ] **Step 2: Change state and selection helpers**

Use:

```js
const STATE = {
  files: { bank: [], wechat: [], alipay: [] },
  analysis: null,
  insights: null,
  budget: null,
  charts: [],
  activeTab: 'overview',
};

function selectedEntries() {
  return Object.entries(STATE.files).flatMap(([source, files]) => files.map((file) => ({ source, file })));
}
```

`selectFiles(source, fileList)` validates each file, rejects exact duplicates by `name + size + lastModified`, preserves previously selected valid files, and checks the combined 40 MiB limit before mutating state. `clearFiles(source)` clears only one source.

- [ ] **Step 3: Parse the flattened queue sequentially**

In `runUploadedAnalysis`, loop over `selectedEntries()` and await one parser at a time. Before each parser, update `#progress` with `正在解析 i/n：filename` and add/update a row in `#file-progress-list`. Catch errors per entry and continue. If every entry fails, throw the first normalized error; otherwise analyze successful records and attach all file-level failures to `analysis.quality.fileErrors`.

- [ ] **Step 4: Keep input and drop behavior source-safe**

Input `change` and card `drop` must pass every selected file to `selectFiles(source, files)`. Bank password applies to every selected bank PDF in the current run and remains memory-only.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add src/app.js tests/structure.test.js
git commit -m "feat: add sequential batch bill imports"
```

## Task 9: Integrate insights, budget, report tabs, theme, and Excel export

**Files:**
- Modify: `src/app.js`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Guard every required runtime module**

At bootstrap, bind:

```js
const Core = window.BillAnalyzerCore;
const Insights = window.BillAnalyzerInsights;
const Budget = window.BillAnalyzerBudget;
const Exporter = window.BillAnalyzerExporter;
```

If any module is absent, render `工具模块未能完整加载，请确认文件完整。` and return before binding handlers.

- [ ] **Step 2: Build the derived report state once**

In `showReport(analysis)`:

```js
STATE.analysis = analysis;
STATE.insights = Insights.analyzeSpendingProfile(analysis, { lastDate: analysis.meta.lastDate });
STATE.budget = Budget.calculateBudget(analysis, Budget.loadBudget());
elements.report.hidden = false;
renderAllReportViews();
activateReportTab('overview');
```

`renderAllReportViews()` calls the existing financial renderers, then `renderMonthComparison`, `renderChangeDrivers`, `renderPortrait`, `renderBudget`, and `renderTransactions`.

- [ ] **Step 3: Implement accessible report tab behavior**

`activateReportTab(name)` sets `STATE.activeTab`, updates every tab's `aria-selected`, toggles `.is-active`, and sets `hidden` on the three panel elements. When activated by click, move focus only to the clicked tab, not into report content.

- [ ] **Step 4: Render the monthly comparison and change drivers**

`renderMonthComparison` must show current vs previous net consumption, signed amount, signed rate when available, and `当前月份仅覆盖 X/Y 天` when incomplete. `renderChangeDrivers` uses `analysis.changeDrivers`; each row shows category name, current, previous, and signed difference.

- [ ] **Step 5: Render the portrait without unsafe HTML**

Construct every node with `document.createElement` and `textContent`. The heatmap must expose the numeric amount in visible text or an `aria-label`, use both intensity and count text, and keep `#time-summary` as a text alternative. Merchant rows show rank, name, count, amount, average, and latest date. Empty sections use specific messages rather than a generic blank card.

- [ ] **Step 6: Wire total and category budget submission and clearing**

Before rendering a saved budget, populate `#budget-categories` from `analysis.categories`. Each row uses a labelled numeric input with `data-budget-category="categoryId"`, `inputmode="decimal"`, `min="0"`, and `step="50"`; display the category name with its current spending beside the input. On submit, collect those inputs into `categories`, normalize `{ total: elements.budgetTotal.value, categories }`, save through `Budget.saveBudget`, recalculate `STATE.budget`, render it, and announce success/failure in `budget-feedback`. Clearing calls `Budget.clearBudget`, clears total and category inputs, recalculates with zero budget, and announces that the current session budget was removed.

- [ ] **Step 7: Wire export confirmation**

Enable `export-button` only after a report exists. On click, call:

```js
if (!window.confirm('Excel 将包含交易明细。请妥善保管，确认导出吗？')) return;
Exporter.exportWorkbook(
  STATE.analysis,
  STATE.insights,
  STATE.budget,
  window.XLSX,
  `钱都去哪了-${STATE.analysis.meta.lastDate || '账单分析'}.xlsx`,
);
```

Catch and announce export errors without resetting the report.

- [ ] **Step 8: Implement current-session theme switching**

Initialize from `matchMedia('(prefers-color-scheme: dark)')`. Theme button toggles `document.documentElement.dataset.theme`, updates `aria-pressed`, recreates ECharts instances so axis and legend colors use current CSS variables, and does not write to local storage.

- [ ] **Step 9: Make chart colors theme-aware**

Read CSS variables with `getComputedStyle(document.documentElement).getPropertyValue(...)`. Remove the current hard-coded beige/forest ECharts colors and pass theme tokens to axes, grids, labels, and series.

- [ ] **Step 10: Run all tests and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add src/app.js
git commit -m "feat: integrate V3 analysis experience"
```

## Task 10: Include all modules in static and offline builds

**Files:**
- Modify: `scripts/build-static.js`
- Modify: `scripts/build-offline.js`
- Modify: `tests/structure.test.js`

- [ ] **Step 1: Add new modules to the static allowlist**

Place these entries after `src/core.js` and before `src/app.js` in dependency order:

```js
'src/insights.js',
'src/budget.js',
'src/exporter.js',
```

Keep `src/app.js` last among application scripts.

- [ ] **Step 2: Inline modules in offline dependency order**

The application part of `scriptSources` must be:

```js
read('src/core.js'),
read('src/insights.js'),
read('src/budget.js'),
read('src/exporter.js'),
replaceBrandPaths(read('src/app.js')),
```

Before `writeFileSync`, create the output directory with:

```js
fs.mkdirSync(path.dirname(output), { recursive: true });
```

- [ ] **Step 3: Extend the offline contract**

Build the artifact and assert it contains `BillAnalyzerInsights`, `BillAnalyzerBudget`, `BillAnalyzerExporter`, all new report IDs, and exactly one HTML document. Continue asserting no external scripts/styles/resources, no user path, no known identity, no network connection, Blob Worker support, and output at `output/钱都去哪了-离线版.html`.

- [ ] **Step 4: Run structure, static, and offline builds**

Run: `npm run test:structure`
Expected: all structure tests PASS.

Run: `npm run build`
Expected: `dist/src/insights.js`, `dist/src/budget.js`, and `dist/src/exporter.js` exist.

Run: `npm run build:offline`
Expected: `output/钱都去哪了-离线版.html` is rebuilt without error.

- [ ] **Step 5: Commit build integration**

```bash
git add scripts/build-static.js scripts/build-offline.js tests/structure.test.js
git commit -m "build: package V3 modules offline"
```

## Task 11: Add project security, contribution, changelog, and CI documentation

**Files:**
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `tests/structure.test.js`

- [ ] **Step 1: Add a failing documentation contract test**

Assert that all four new files exist. Assert `SECURITY.md` contains local-only processing, CSP, no bill uploads, and private vulnerability reporting guidance. Assert `CONTRIBUTING.md` forbids real bill fixtures. Assert the CI workflow runs `npm test`, `npm run build`, and `npm run build:offline`.

- [ ] **Step 2: Write the security and contribution policies**

`SECURITY.md` must document the threat model, supported V3 branch, no-network runtime, memory-only PDF passwords, session-only budget, spreadsheet formula neutralization, and a request to avoid public disclosure of vulnerabilities containing financial data.

`CONTRIBUTING.md` must require synthetic fixtures, `npm test`, both builds, no CDN/runtime dependency, no personal paths, and explicit test updates for classification or parsing changes.

- [ ] **Step 3: Write the changelog and update README**

`CHANGELOG.md` gets a `3.0.0 — 2026-07-13` entry covering insights, budgets, Excel export, batch progress, visual redesign, dark mode, and preserved offline privacy.

Update `README.md` to use the actual launcher paths under `tools/`, document the six Excel sheets, explain session-only budgets, and keep the honest desktop-first/mobile-best-effort opening guidance.

- [ ] **Step 4: Add deterministic CI**

Create:

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm test
      - run: npm run build
      - run: npm run build:offline
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add README.md SECURITY.md CHANGELOG.md CONTRIBUTING.md .github/workflows/ci.yml tests/structure.test.js
git commit -m "docs: document V3 privacy and delivery"
```

## Task 12: Perform browser, accessibility, and layout verification

**Files:**
- Modify when evidence requires: `index.html`
- Modify when evidence requires: `styles.css`
- Modify when evidence requires: `src/app.js`

- [ ] **Step 1: Start the local-only server**

Run: `python3 tools/start.py --no-browser`
Expected: prints a `http://127.0.0.1:<port>/index.html` URL and binds only to `127.0.0.1`.

- [ ] **Step 2: Exercise the sample report at four viewport widths**

Use a real browser at 375×812, 768×1024, 1024×768, and 1440×1000. For each width: click `查看脱敏示例`, switch all three report tabs, submit and clear a budget, toggle the theme, filter transactions, and invoke Excel export up to the confirmation prompt.

Expected: no overlap, no clipped labels, no page-level horizontal scroll, no hidden actionable content, and no browser console error.

- [ ] **Step 3: Check keyboard and motion behavior**

Navigate from the skip link through upload, analysis, tabs, budget, export, filters, and reset using only Tab/Shift+Tab/Enter/Space. Emulate reduced motion and verify report scrolling and transitions become immediate.

Expected: every control has a visible focus indicator; tab order matches visual order; no keyboard trap; charts retain text summaries.

- [ ] **Step 4: Fix only evidence-backed browser issues and rerun tests**

For each observed issue, add the smallest relevant regression assertion to `tests/structure.test.js` when possible, apply the fix, rerun `npm test`, and recheck the affected viewport.

- [ ] **Step 5: Commit verified UI fixes if any files changed**

```bash
git add index.html styles.css src/app.js tests/structure.test.js
git commit -m "fix: harden responsive V3 experience"
```

If no file changed, skip this commit.

## Task 13: Final privacy and offline delivery verification

**Files:**
- Generate: `output/钱都去哪了-离线版.html`

- [ ] **Step 1: Run every automated check from a clean process**

Run: `npm test`
Expected: zero failures.

Run: `npm run build`
Expected: static build completes and contains only allowlisted public files.

Run: `npm run build:offline`
Expected: one offline HTML file is generated.

- [ ] **Step 2: Compile every authored JavaScript file**

Run:

```bash
node -e "const fs=require('node:fs'),vm=require('node:vm');for(const f of ['src/core.js','src/insights.js','src/budget.js','src/exporter.js','src/app.js','scripts/build-static.js','scripts/build-offline.js','scripts/build-github-pages.js'])new vm.Script(fs.readFileSync(f,'utf8'),{filename:f});console.log('JavaScript syntax OK')"
```

Expected: `JavaScript syntax OK`.

- [ ] **Step 3: Inspect the generated file for privacy and self-containment**

Run searches that confirm one document, no `<script src>`, no stylesheet link, no `http://` or `https://` runtime URL, no `/Users/`, no real bill extensions, and no legacy identity strings. Confirm CSP still includes `connect-src 'none'` and `worker-src blob:`.

- [ ] **Step 4: Open the generated file without the local server**

Open `output/钱都去哪了-离线版.html` directly in Safari or Chrome with networking disabled. Run the sample report, switch tabs, set budget, toggle theme, and confirm Excel export reaches a local download.

Expected: all V3 functions operate without network access.

- [ ] **Step 5: Review the working tree without disturbing existing user changes**

Run: `git status --short`
Expected: generated `output/` and `dist/` remain ignored; any pre-existing moved tools or user files remain intact. Do not use reset, checkout, clean, or broad staging commands.

- [ ] **Step 6: Hand off the final artifact**

Provide the absolute clickable path to `output/钱都去哪了-离线版.html`, report the exact automated-test count, list tested viewport widths, and repeat the desktop-recommended/mobile-best-effort opening guidance without claiming universal iOS local-HTML compatibility.
