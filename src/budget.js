(function initBillAnalyzerBudget(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerBudget() {
  'use strict';

  const STORAGE_KEY = 'money-where-budget-v3';

  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, roundMoney(number)) : 0;
  }

  function normalizeBudget(input = {}) {
    const categories = input && typeof input.categories === 'object' && input.categories
      ? input.categories
      : {};
    return {
      total: nonNegative(input && input.total),
      categories: Object.fromEntries(Object.entries(categories).map(([id, value]) => [id, nonNegative(value)])),
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

  function monthInfo(lastDate) {
    const match = /^(20\d{2})-(0[1-9]|1[0-2])-(\d{2})$/u.exec(lastDate || '');
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return {
      month: `${match[1]}-${match[2]}`,
      elapsedDays: day,
      daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    };
  }

  function netAmount(items, categoryId) {
    return Math.max(0, roundMoney(items.reduce((sum, item) => {
      if (categoryId && item.categoryId !== categoryId) return sum;
      if (item.flowType === 'expense') return sum + Number(item.amount || 0);
      if (item.flowType === 'refund') return sum - Number(item.amount || 0);
      return sum;
    }, 0)));
  }

  function calculateBudget(analysis = {}, input) {
    const budget = normalizeBudget(input);
    const info = monthInfo(analysis.meta && analysis.meta.lastDate);
    const rows = info
      ? (analysis.transactions || []).filter((item) => String(item.date || '').startsWith(info.month))
      : [];
    const spent = netAmount(rows);
    const categoryIds = new Set([
      ...Object.keys(budget.categories),
      ...rows.map((item) => item.categoryId).filter(Boolean),
    ]);
    const categories = Object.fromEntries(Array.from(categoryIds).map((id) => {
      const limit = budget.categories[id] || 0;
      const categorySpent = netAmount(rows, id);
      return [id, {
        limit,
        spent: categorySpent,
        remaining: roundMoney(limit - categorySpent),
        progress: limit > 0 ? Math.max(0, Math.round((categorySpent / limit) * 100)) : null,
      }];
    }));

    return {
      month: info ? info.month : '',
      total: budget.total,
      spent,
      remaining: roundMoney(budget.total - spent),
      progress: budget.total > 0 ? Math.max(0, Math.round((spent / budget.total) * 100)) : null,
      projected: info ? roundMoney((spent / info.elapsedDays) * info.daysInMonth) : 0,
      categories,
    };
  }

  return {
    STORAGE_KEY,
    calculateBudget,
    clearBudget,
    loadBudget,
    normalizeBudget,
    saveBudget,
  };
});
