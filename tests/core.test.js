const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeTransactions,
  buildRecommendations,
  classifyTransaction,
  escapeHtml,
  reconcileTransactions,
} = require('../src/core.js');

function tx(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    source: 'wechat',
    date: '2026-06-15',
    time: '12:00:00',
    datetime: '2026-06-15 12:00:00',
    amount: 28,
    direction: 'expense',
    merchant: '测试商户',
    description: '普通消费',
    searchText: '测试商户 普通消费',
    channel: '微信支付',
    paymentMethod: '零钱',
    status: '支付成功',
    ...overrides,
  };
}

test('investment purchase is an asset flow rather than consumption', () => {
  const result = classifyTransaction(tx({ searchText: '基金申购 肯特瑞', description: '基金申购' }));

  assert.equal(result.flowType, 'asset');
  assert.equal(result.categoryId, 'asset-investment');
});

test('credit repayment is a debt flow rather than consumption', () => {
  const result = classifyTransaction(tx({ direction: 'neutral', searchText: '花呗还款', description: '花呗还款' }));

  assert.equal(result.flowType, 'debt');
  assert.equal(result.categoryId, 'debt-repayment');
});

test('refund offsets spending instead of becoming income', () => {
  const result = classifyTransaction(tx({ direction: 'income', searchText: '淘宝 商品退款', description: '商品退款' }));

  assert.equal(result.flowType, 'refund');
  assert.equal(result.categoryId, 'refund');
});

test('food is essential consumption with traceable rule metadata', () => {
  const result = classifyTransaction(tx({ searchText: '美团外卖 午餐', merchant: '美团外卖' }));

  assert.equal(result.flowType, 'expense');
  assert.equal(result.needType, 'essential');
  assert.equal(result.categoryId, 'food');
  assert.ok(result.ruleId);
  assert.ok(result.confidence >= 0.8);
});

test('shopping is discretionary consumption', () => {
  const result = classifyTransaction(tx({ searchText: '淘宝 服饰', merchant: '淘宝' }));

  assert.equal(result.flowType, 'expense');
  assert.equal(result.needType, 'discretionary');
  assert.equal(result.categoryId, 'shopping');
});

test('video membership is classified as discretionary entertainment', () => {
  const result = classifyTransaction(tx({ searchText: '视频会员 自动续费', merchant: '视频会员' }));

  assert.equal(result.flowType, 'expense');
  assert.equal(result.needType, 'discretionary');
  assert.equal(result.categoryId, 'entertainment');
});

test('shared bike and explicit payment transfer receive useful categories', () => {
  assert.equal(classifyTransaction(tx({ searchText: '财付通-哈啰单车' })).categoryId, 'transport');
  assert.equal(classifyTransaction(tx({ searchText: '财付通-转账' })).categoryId, 'social');
});

test('platform category labels and QR payments stay useful without false precision', () => {
  assert.equal(classifyTransaction(tx({ searchText: '支付宝 文化休闲' })).categoryId, 'entertainment');
  assert.equal(classifyTransaction(tx({ searchText: '支付宝 服饰装扮' })).categoryId, 'shopping');
  assert.equal(classifyTransaction(tx({ searchText: '支付宝 宠物' })).categoryId, 'pets');
  const qr = classifyTransaction(tx({ searchText: '微信 扫二维码付款' }));
  assert.equal(qr.categoryId, 'offline-qr');
  assert.equal(qr.needType, 'unclassified');
});

test('data quality counts uncertain semantic categories as needing review', () => {
  const result = analyzeTransactions([tx({ id: 'qr', searchText: '扫二维码付款' })]);

  assert.equal(result.quality.unclassifiedCount, 1);
  assert.equal(result.quality.unclassifiedRate, 100);
});

test('same-source repeated purchases are preserved without transaction IDs', () => {
  const first = tx({ id: '', merchant: '便利店', amount: 12 });
  const second = tx({ id: '', merchant: '便利店', amount: 12 });
  const result = reconcileTransactions([first, second]);

  assert.equal(result.transactions.length, 2);
  assert.equal(result.quality.sameSourceDuplicates, 0);
});

test('exact platform transaction IDs deduplicate within one source', () => {
  const first = tx({ id: 'wx-order-1' });
  const second = tx({ id: 'wx-order-1' });
  const result = reconcileTransactions([first, second]);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.quality.sameSourceDuplicates, 1);
});

test('unique bank and payment-app views are linked once', () => {
  const bank = tx({
    id: 'bank-1', source: 'bank', channel: '财付通', paymentMethod: '银行卡',
    merchant: '财付通', searchText: '财付通 微信支付', time: '12:00:01',
  });
  const wechat = tx({ id: 'wx-1', time: '12:00:03' });
  const result = reconcileTransactions([bank, wechat]);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].source, 'wechat');
  assert.equal(result.quality.matchedPairs, 1);
});

test('ambiguous cross-source candidates remain and emit a warning', () => {
  const bank = tx({
    id: 'bank-1', source: 'bank', channel: '财付通', merchant: '财付通',
    searchText: '财付通 微信支付', time: '',
  });
  const one = tx({ id: 'wx-1', time: '' });
  const two = tx({ id: 'wx-2', time: '' });
  const result = reconcileTransactions([bank, one, two]);

  assert.equal(result.transactions.length, 3);
  assert.equal(result.quality.ambiguousMatches, 1);
});

test('missing time can link only one compatible candidate', () => {
  const bank = tx({
    id: 'bank-1', source: 'bank', channel: '支付宝', merchant: '支付宝',
    searchText: '支付宝快捷支付', time: '',
  });
  const alipay = tx({ id: 'ali-1', source: 'alipay', channel: '支付宝', time: '' });
  const result = reconcileTransactions([bank, alipay]);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.quality.matchedPairs, 1);
});

test('net spending excludes transfers, assets and debt and subtracts refunds', () => {
  const records = [
    tx({ id: 'salary', source: 'bank', direction: 'income', amount: 10000, searchText: '代发工资', merchant: '公司' }),
    tx({ id: 'food', amount: 2000, searchText: '餐饮 午餐', merchant: '餐饮商户' }),
    tx({ id: 'shopping', amount: 1000, searchText: '淘宝 购物', merchant: '淘宝' }),
    tx({ id: 'refund', direction: 'income', amount: 500, searchText: '淘宝 退款', merchant: '淘宝' }),
    tx({ id: 'asset', amount: 1500, searchText: '基金申购', merchant: '基金平台' }),
    tx({ id: 'debt', direction: 'neutral', amount: 1200, searchText: '花呗还款', merchant: '花呗' }),
    tx({ id: 'transfer', direction: 'neutral', amount: 800, searchText: '余额宝转入', merchant: '余额宝' }),
  ];
  const result = analyzeTransactions(records);

  assert.equal(result.summary.totalIncome, 10000);
  assert.equal(result.summary.grossExpense, 3000);
  assert.equal(result.summary.refunds, 500);
  assert.equal(result.summary.netExpense, 2500);
  assert.equal(result.summary.cashBalance, 7500);
  assert.equal(result.summary.assetFlow, 1500);
  assert.equal(result.summary.debtFlow, 1200);
  assert.equal(result.summary.transferFlow, 800);
});

test('inclusive coverage makes a one-day report use one day', () => {
  const result = analyzeTransactions([tx({ id: 'food', amount: 30, searchText: '早餐' })]);

  assert.equal(result.meta.coverageDays, 1);
  assert.equal(result.summary.dailyAverage, 30);
});

test('zero income produces a null savings rate rather than a misleading zero', () => {
  const result = analyzeTransactions([tx({ id: 'food', amount: 30, searchText: '早餐' })]);

  assert.equal(result.summary.savingsRate, null);
});

test('recommendations cite evidence and contain no product pitch', () => {
  const analysis = analyzeTransactions([
    tx({ id: 'salary', source: 'bank', direction: 'income', amount: 10000, searchText: '代发工资' }),
    tx({ id: 'food', amount: 4500, searchText: '餐饮 外卖', merchant: '外卖平台' }),
  ]);
  const recommendations = buildRecommendations(analysis);
  const text = JSON.stringify(recommendations);

  assert.ok(recommendations.length > 0);
  assert.ok(recommendations.every((item) => item.evidence && item.action));
  assert.doesNotMatch(text, /指数基金|余额宝|花呗额度|年化收益|50%稳健|自动定投/);
});

test('escapeHtml neutralizes imported markup', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('</script>'), '&lt;/script&gt;');
  assert.equal(escapeHtml('A&B"\''), 'A&amp;B&quot;&#39;');
});
