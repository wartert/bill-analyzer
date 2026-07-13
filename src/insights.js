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
  const MEAL_SCENES = [
    { id: 'breakfast', label: '早餐', keywords: ['早餐', '早饭', '早点', '包子', '豆浆'] },
    { id: 'lunch', label: '午餐', keywords: ['午餐', '午饭', '中饭', '食堂'] },
    { id: 'dinner', label: '晚餐', keywords: ['晚餐', '晚饭', '夜宵'] },
    { id: 'delivery', label: '外卖', keywords: ['外卖', '饿了么', '美团配送', '美团'] },
    { id: 'coffee', label: '咖啡饮品', keywords: ['咖啡', 'coffee', '瑞幸', '星巴克', 'manner', '库迪'] },
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

  function buildMonthlyComparison(analysis, options) {
    const monthly = (analysis.monthly || []).filter((item) => /^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(item.month || ''));
    if (monthly.length < 2) return null;
    const [previousEntry, currentEntry] = monthly.slice(-2);
    const current = roundMoney(currentEntry.netExpense);
    const previous = roundMoney(previousEntry.netExpense);
    const change = roundMoney(current - previous);
    const changeRate = previous > 0 ? roundMoney((change / previous) * 100) : null;
    const [year, month] = currentEntry.month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastDate = options.lastDate || analysis.meta?.lastDate || '';
    const lastDayMatch = new RegExp(`^${currentEntry.month}-(\\d{2})$`, 'u').exec(lastDate);
    const lastDay = lastDayMatch ? Number(lastDayMatch[1]) : null;
    const coverageDays = lastDay && lastDay <= daysInMonth ? lastDay : daysInMonth;

    return {
      currentMonth: currentEntry.month,
      previousMonth: previousEntry.month,
      current,
      previous,
      change,
      changeRate,
      complete: coverageDays === daysInMonth,
      coverageDays,
      daysInMonth,
    };
  }

  function buildMerchants(expenses) {
    const groups = new Map();
    expenses.forEach((item) => {
      const name = String(item.merchant || '').trim();
      if (!name || name === '商户待确认') return;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    });

    return [...groups.entries()]
      .filter(([, items]) => items.length >= 2)
      .map(([name, items]) => ({
        name,
        ...aggregate(items),
        latestDate: items.reduce((latest, item) => (item.date > latest ? item.date : latest), ''),
        categoryName: items.find((item) => item.categoryName)?.categoryName || '',
      }))
      .sort((left, right) => right.count - left.count || right.amount - left.amount)
      .slice(0, 20);
  }

  function buildMealScenes(expenses) {
    return MEAL_SCENES.map((scene) => {
      const matches = expenses.filter((item) => {
        const text = `${item.merchant || ''} ${item.description || ''} ${item.searchText || ''}`.toLowerCase();
        return scene.keywords.some((keyword) => text.includes(keyword));
      });
      return { id: scene.id, label: scene.label, ...aggregate(matches) };
    }).filter((scene) => scene.count > 0);
  }

  function buildSample(expenses) {
    const validDates = expenses
      .filter((item) => weekdayNumber(item.date) !== null)
      .map((item) => Date.parse(`${item.date}T00:00:00Z`));
    const spanDays = validDates.length
      ? Math.floor((Math.max(...validDates) - Math.min(...validDates)) / 86400000) + 1
      : 0;
    const temporalCount = expenses.filter((item) => bucketFor(item.time)).length;
    const expenseCount = expenses.length;
    return {
      expenseCount,
      temporalCount,
      spanDays,
      sufficient: expenseCount >= 12 && temporalCount >= 8 && spanDays >= 28,
    };
  }

  function buildHabits(sample, mealScenes, weekPattern, timeProfile) {
    if (!sample.sufficient) return [];
    const habits = [];
    const coffee = mealScenes.find((scene) => scene.id === 'coffee');
    if (coffee?.count >= 5) {
      habits.push({
        id: 'coffee-regular',
        label: '咖啡消费较固定',
        evidence: `咖啡消费 ${coffee.count} 笔，共 ${coffee.amount} 元。`,
      });
    }
    const delivery = mealScenes.find((scene) => scene.id === 'delivery');
    if (delivery?.count >= 6) {
      habits.push({
        id: 'delivery-frequent',
        label: '外卖消费较频繁',
        evidence: `外卖消费 ${delivery.count} 笔，共 ${delivery.amount} 元。`,
      });
    }
    const lateNight = timeProfile.buckets.find((bucket) => bucket.id === 'late-night');
    if (lateNight.count >= 4) {
      habits.push({
        id: 'late-night-spending',
        label: '存在深夜消费',
        evidence: `深夜消费 ${lateNight.count} 笔，共 ${lateNight.amount} 元。`,
      });
    }
    if (weekPattern.weekend.count >= 4 && weekPattern.weekend.average > weekPattern.weekday.average * 1.25) {
      habits.push({
        id: 'weekend-premium',
        label: '周末客单价更高',
        evidence: `周末消费 ${weekPattern.weekend.count} 笔，共 ${weekPattern.weekend.amount} 元；工作日消费 ${weekPattern.weekday.count} 笔，共 ${weekPattern.weekday.amount} 元。`,
      });
    }
    return habits;
  }

  function buildRecommendations(monthlyComparison, sample, timeProfile, merchants) {
    const recommendations = [];
    if (monthlyComparison && !monthlyComparison.complete) {
      recommendations.push({
        id: 'partial-month',
        tone: 'neutral',
        title: '本月数据尚未完整',
        evidence: `${monthlyComparison.currentMonth} 仅覆盖 ${monthlyComparison.coverageDays}/${monthlyComparison.daysInMonth} 天。`,
        impact: '当前金额不适合直接和完整月份比较。',
        action: '等本月数据完整后，再判断环比变化。',
      });
    }
    if (monthlyComparison?.complete && monthlyComparison.changeRate !== null && Math.abs(monthlyComparison.changeRate) >= 15) {
      const increased = monthlyComparison.change > 0;
      recommendations.push({
        id: 'month-change',
        tone: increased ? 'attention' : 'positive',
        title: `本月净消费环比${increased ? '上升' : '下降'} ${Math.abs(monthlyComparison.changeRate)}%`,
        evidence: `${monthlyComparison.currentMonth} 为 ${monthlyComparison.current} 元，${monthlyComparison.previousMonth} 为 ${monthlyComparison.previous} 元，变化 ${monthlyComparison.change} 元。`,
        impact: `完整月份的消费较上月明显${increased ? '上升' : '下降'}。`,
        action: increased ? '回看增长最多的消费场景，确认是否需要调整。' : '回看减少最多的消费场景，确认哪些变化值得保持。',
      });
    }
    if (sample.sufficient) {
      const lateNight = timeProfile.buckets.find((bucket) => bucket.id === 'late-night');
      if (lateNight.count >= 4) {
        recommendations.push({
          id: 'late-night',
          tone: 'attention',
          title: '深夜消费出现较频繁',
          evidence: `深夜消费 ${lateNight.count} 笔，共 ${lateNight.amount} 元。`,
          impact: '深夜时段的消费更容易缺少当下比较。',
          action: '下次深夜消费前先停一分钟，确认是否确有需要。',
        });
      }
      const topMerchant = merchants[0];
      if (topMerchant?.count >= 5) {
        recommendations.push({
          id: 'top-merchant',
          tone: 'neutral',
          title: `${topMerchant.name}是高频消费商户`,
          evidence: `${topMerchant.name}共 ${topMerchant.count} 笔，${topMerchant.amount} 元，平均 ${topMerchant.average} 元。`,
          impact: '固定商户的小额多次消费会逐步累积。',
          action: '回看这些消费是否都符合当时的实际需要。',
        });
      }
    }
    return recommendations.slice(0, 4);
  }

  function analyzeSpendingProfile(analysis, options = {}) {
    const expenses = expensesOf(analysis);
    const sample = buildSample(expenses);
    const weekPattern = buildWeekPattern(expenses);
    const timeProfile = buildTimeProfile(expenses);
    const mealScenes = buildMealScenes(expenses);
    const merchants = buildMerchants(expenses);
    const monthlyComparison = buildMonthlyComparison(analysis, options);
    return {
      sample,
      weekPattern,
      timeProfile,
      monthlyComparison,
      merchants,
      mealScenes,
      habits: buildHabits(sample, mealScenes, weekPattern, timeProfile),
      recommendations: buildRecommendations(monthlyComparison, sample, timeProfile, merchants),
    };
  }

  return { TIME_BUCKETS, analyzeSpendingProfile, bucketFor, weekdayNumber };
});
