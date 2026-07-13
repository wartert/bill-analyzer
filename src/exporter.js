(function initBillAnalyzerExporter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerExporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerExporter() {
  'use strict';

  const SHEET_NAMES = ['总览', '月度趋势', '分类分析', '商家分析', '交易明细', '数据质量'];
  const HEADERS = {
    总览: ['指标', '数值'],
    月度趋势: ['月份', '收入', '总消费', '退款', '净消费', '结余', '净消费环比'],
    分类分析: ['分类', '金额', '占比', '笔数', '客单价', '消费属性'],
    商家分析: ['商家', '次数', '总金额', '客单价', '最近日期', '主要分类'],
    交易明细: ['日期', '时间', '资金流', '商家', '分类', '来源', '金额', '说明', '规则', '置信度'],
    数据质量: ['指标', '数量', '说明'],
  };

  function safeCell(value) {
    if (typeof value !== 'string') return value;
    const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '');
    return /^\s*[=+\-@]/u.test(clean) ? `'${clean}` : clean;
  }

  function safeRow(row) {
    return row.map(safeCell);
  }

  function rateForMonth(item, previous) {
    if (!previous || Number(previous.netExpense) <= 0) return null;
    const rate = ((Number(item.netExpense || 0) - Number(previous.netExpense || 0)) / Number(previous.netExpense)) * 100;
    return Math.round((rate + Number.EPSILON) * 10) / 10;
  }

  function buildWorkbookData(analysis = {}, insights = {}, budgetStatus = {}) {
    const meta = analysis.meta || {};
    const summary = analysis.summary || {};
    const quality = analysis.quality || {};
    const months = (analysis.monthly || []).slice().sort((left, right) => String(left.month || '').localeCompare(String(right.month || '')));
    let previous = null;
    const monthlyRows = months.map((item) => {
      const row = [
        item.month || '',
        Number(item.income || 0),
        Number(item.grossExpense || 0),
        Number(item.refunds || 0),
        Number(item.netExpense || 0),
        Number(item.balance || 0),
        rateForMonth(item, previous),
      ];
      previous = item;
      return safeRow(row);
    });

    return {
      总览: [HEADERS.总览, ...[
        ['数据范围', meta.dateRange || ''],
        ['覆盖天数', Number(meta.coverageDays || 0)],
        ['真实收入', Number(summary.totalIncome || 0)],
        ['净消费', Number(summary.netExpense || 0)],
        ['现金结余', Number(summary.cashBalance || 0)],
        ['结余率', summary.savingsRate == null ? null : Number(summary.savingsRate)],
        ['预算', Number(budgetStatus.total || 0)],
        ['预算剩余', budgetStatus.remaining == null ? null : Number(budgetStatus.remaining)],
      ].map(safeRow)],
      月度趋势: [HEADERS.月度趋势, ...monthlyRows],
      分类分析: [HEADERS.分类分析, ...(analysis.categories || []).map((item) => safeRow([
        item.name || '', Number(item.amount || 0), Number(item.share || 0), Number(item.count || 0), Number(item.average || 0), item.needType || '',
      ]))],
      商家分析: [HEADERS.商家分析, ...((insights && insights.merchants) || []).map((item) => safeRow([
        item.name || '', Number(item.count || 0), Number(item.amount || 0), Number(item.average || 0), item.latestDate || '', item.categoryName || '',
      ]))],
      交易明细: [HEADERS.交易明细, ...(analysis.transactions || []).map((item) => safeRow([
        item.date || '', item.time || '', item.flowType || '', item.merchant || '', item.categoryName || '', item.source || '', Number(item.amount || 0), item.description || '', item.ruleId || '', item.confidence == null ? null : Number(item.confidence),
      ]))],
      数据质量: [HEADERS.数据质量, ...[
        ['原始记录', Number(quality.rawRecords || 0), '导入文件中的交易行'],
        ['有效记录', Number(quality.validRecords || 0), '完成过滤和去重后'],
        ['忽略记录', Number(quality.ignoredRecords || 0), '关闭、失败或退回等状态'],
        ['跨来源关联', Number(quality.matchedPairs || 0), '银行卡与支付平台唯一匹配'],
        ['歧义候选', Number(quality.ambiguousMatches || 0), '为避免误删而保留'],
        ['字段警告', Number(quality.warningCount || 0), '缺失状态或字段等提示'],
      ].map(safeRow)],
    };
  }

  function exportWorkbook(analysis, insights, budgetStatus, xlsx, filename) {
    if (!xlsx || !xlsx.utils || typeof xlsx.utils.book_new !== 'function' || typeof xlsx.utils.aoa_to_sheet !== 'function' || typeof xlsx.utils.book_append_sheet !== 'function' || typeof xlsx.writeFile !== 'function') {
      throw new Error('Excel 导出组件未加载。');
    }
    const workbook = xlsx.utils.book_new();
    const data = buildWorkbookData(analysis, insights, budgetStatus);
    SHEET_NAMES.forEach((name) => {
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(data[name]), name);
    });
    xlsx.writeFile(workbook, filename, { compression: true });
  }

  return { SHEET_NAMES, buildWorkbookData, exportWorkbook, safeCell };
});
