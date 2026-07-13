const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTransaction,
  extractPdfTableRows,
  normalizeAlipayRow,
  normalizeBankRow,
  normalizeStatementLineEndings,
  normalizeWechatRow,
} = require('../src/core.js');

function pdfItem(value, row, column, rotated = true, size = 8) {
  return {
    str: value,
    transform: rotated ? [0, size, -size, 0, row, column] : [size, 0, 0, size, column, row],
    width: String(value).length * size,
    height: size,
  };
}

test('wechat closed or failed rows are ignored with an explicit reason', () => {
  const failed = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:00',
    '收/支': '支出',
    '金额(元)': '¥20.00',
    '当前状态': '支付失败',
  });
  const closed = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:00',
    '收/支': '支出',
    '金额(元)': '¥20.00',
    '当前状态': '已关闭',
  });

  assert.equal(failed.ignoredReason, 'invalid-status');
  assert.equal(closed.ignoredReason, 'invalid-status');
});

test('wechat returned transfer and fully refunded rows have zero spending effect', () => {
  const returned = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:00', '收/支': '支出', '金额(元)': '20', '当前状态': '对方已退还',
  });
  const refunded = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:00', '收/支': '支出', '金额(元)': '20', '当前状态': '已全额退款',
  });

  assert.equal(returned.ignoredReason, 'returned-transfer');
  assert.equal(refunded.ignoredReason, 'fully-refunded');
});

test('wechat partial refund creates a separate refund adjustment', () => {
  const result = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:00',
    '交易类型': '商户消费',
    '交易对方': '测试商店',
    '商品': '测试商品',
    '收/支': '支出',
    '金额(元)': '20',
    '当前状态': '已退款(¥5.00)',
    '交易单号': 'wx-partial-1',
  });

  assert.equal(result.transaction.direction, 'expense');
  assert.equal(result.adjustments.length, 1);
  assert.equal(result.adjustments[0].amount, 5);
  assert.equal(classifyTransaction(result.adjustments[0]).flowType, 'refund');
});

test('wechat row maps official columns and transaction ID', () => {
  const result = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:45',
    '交易类型': '商户消费',
    '交易对方': '测试餐厅',
    '商品': '午餐',
    '收/支': '支出',
    '金额(元)': '¥28.50',
    '支付方式': '零钱',
    '当前状态': '支付成功',
    '交易单号': 'wx-001',
    '备注': '工作餐',
  });

  assert.equal(result.transaction.source, 'wechat');
  assert.equal(result.transaction.date, '2026-06-01');
  assert.equal(result.transaction.time, '12:30:45');
  assert.equal(result.transaction.amount, 28.5);
  assert.equal(result.transaction.direction, 'expense');
  assert.equal(result.transaction.id, 'wx-001');
  assert.match(result.transaction.searchText, /测试餐厅/);
  assert.match(result.transaction.searchText, /工作餐/);
});

test('alipay successful refund row becomes refund flow', () => {
  const normalized = normalizeAlipayRow({
    '交易时间': '2026-06-02 08:12:00',
    '交易分类': '退款',
    '交易对方': '测试商店',
    '商品说明': '含逗号, 的商品退款',
    '收/支': '收入',
    '金额': '88.00',
    '收/付款方式': '余额',
    '交易状态': '交易成功',
    '交易订单号': 'ali-001',
  });
  const classified = classifyTransaction(normalized.transaction);

  assert.equal(normalized.transaction.description, '含逗号, 的商品退款');
  assert.equal(normalized.transaction.id, 'ali-001');
  assert.equal(classified.flowType, 'refund');
});

test('alipay closed rows are ignored and neutral direction is preserved', () => {
  const closed = normalizeAlipayRow({ '交易状态': '交易关闭', '金额': '10', '收/支': '支出' });
  const neutral = normalizeAlipayRow({
    '交易时间': '2026-06-02 08:12:00',
    '交易对方': '余额宝',
    '商品说明': '余额宝转入',
    '收/支': '不计收支',
    '金额': '1000',
    '交易状态': '交易成功',
  });

  assert.equal(closed.ignoredReason, 'invalid-status');
  assert.equal(neutral.transaction.direction, 'neutral');
});

test('mixed Alipay export line endings are normalized before CSV parsing', () => {
  const exported = [
    '支付宝交易记录明细查询\r\n',
    '说明：\r\n',
    '交易时间,交易分类,交易对方,金额\n',
    '2026-07-01 08:00:00,餐饮美食,示例商户,12.00\n',
    '2026-07-02 09:00:00,交通出行,示例交通,5.00\n',
  ].join('');

  const normalized = normalizeStatementLineEndings(exported);

  assert.equal(normalized.includes('\r'), false);
  assert.equal(normalized.split('\n').filter(Boolean).length, 5);
});

test('bank row handles separate income and expense amount columns', () => {
  const expense = normalizeBankRow({
    '交易日期': '20260603',
    '交易时间': '09:01:02',
    '支出金额': '1,234.56',
    '收入金额': '',
    '对方户名': '支付宝',
    '摘要': '支付宝快捷支付',
    '交易渠道': '网联',
    '流水号': 'bank-001',
  });
  const income = normalizeBankRow({
    '交易日期': '2026/06/04',
    '收入金额': '10,000.00',
    '支出金额': '',
    '摘要': '代发工资',
  });

  assert.equal(expense.transaction.date, '2026-06-03');
  assert.equal(expense.transaction.amount, 1234.56);
  assert.equal(expense.transaction.direction, 'expense');
  assert.equal(expense.transaction.id, 'bank-001');
  assert.equal(income.transaction.direction, 'income');
  assert.equal(income.transaction.amount, 10000);
});

test('bank 收支状态 is treated as direction rather than lifecycle status', () => {
  const result = normalizeBankRow({
    '交易日期': '20260605',
    '交易时间': '09:10:11',
    '金额': '500.00',
    '收支状态': '收入',
    '附言': '测试入账',
  });

  assert.equal(result.transaction.direction, 'income');
  assert.deepEqual(result.transaction.warnings, []);
});

test('bank payment-rail counterparty is replaced by merchant from description', () => {
  const wechatRail = normalizeBankRow({
    '交易日期': '20260605', '金额': '58', '收支状态': '支出',
    '对方户名': '财付通支付科技有限公司', '附言': '财付通-城市咖啡', '交易渠道': '网联',
  });
  const alipayRail = normalizeBankRow({
    '交易日期': '20260605', '金额': '88', '收支状态': '支出',
    '对方户名': '支付宝(中国)网络技术有限公司', '附言': '支付宝-线上商城', '交易渠道': '网联',
  });

  assert.equal(wechatRail.transaction.merchant, '城市咖啡');
  assert.equal(alipayRail.transaction.merchant, '线上商城');
});

test('wechat Excel date cells retain calendar date and time', () => {
  const result = normalizeWechatRow({
    '交易时间': new Date(Date.UTC(2026, 5, 6, 7, 8, 9)),
    '交易对方': '测试商户',
    '收/支': '支出',
    '金额(元)': 20,
    '当前状态': '支付成功',
  });

  assert.equal(result.transaction.date, '2026-06-06');
  assert.equal(result.transaction.time, '07:08:09');
});

test('rotated bank PDF table is reconstructed by visual row and header columns', () => {
  const headerRow = 122;
  const dataRow = 148;
  const columns = [28, 74, 129, 187, 247, 312, 410, 488, 559, 633, 695, 742];
  const headers = ['交易日期', '交易时间', '金额', '收支状态', '余额', '对方行名', '对方户名', '对方账号', '交易渠道', '交易类型', '币种', '附言'];
  const values = ['20260606', '07:08:09', '58', '支出', '20000', '测试银行', '城市咖啡', '6222000000000000', '网联', '消费', '人民币', '财付通-城市咖啡'];
  const items = [
    ...headers.map((value, index) => pdfItem(value, headerRow, columns[index], true, 9)),
    ...values.map((value, index) => pdfItem(value, dataRow, columns[index], true, 8)),
    pdfItem('补充说明', dataRow + 6, columns[11] + 4, true, 8),
  ];

  const rows = extractPdfTableRows(items);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]['交易日期'], '20260606');
  assert.equal(rows[0]['交易时间'], '07:08:09');
  assert.equal(rows[0]['对方户名'], '城市咖啡');
  assert.match(rows[0]['附言'], /补充说明/);
  const normalized = normalizeBankRow(rows[0]).transaction;
  assert.equal(normalized.date, '2026-06-06');
  assert.equal(normalized.direction, 'expense');
  assert.equal(normalized.amount, 58);
});

test('horizontal bank PDF table uses the same extraction API', () => {
  const headerRow = 700;
  const dataRow = 680;
  const columns = [28, 92, 150, 210, 270, 350, 450];
  const headers = ['交易日期', '交易时间', '金额', '收支状态', '对方户名', '交易渠道', '附言'];
  const values = ['20260607', '09:10:11', '100', '收入', '测试单位', '网银', '测试入账'];
  const items = [
    ...headers.map((value, index) => pdfItem(value, headerRow, columns[index], false, 9)),
    ...values.map((value, index) => pdfItem(value, dataRow, columns[index], false, 8)),
  ];

  const rows = extractPdfTableRows(items);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]['收支状态'], '收入');
  assert.equal(rows[0]['附言'], '测试入账');
});

test('missing status stays usable but carries a data-quality warning', () => {
  const result = normalizeWechatRow({
    '交易时间': '2026-06-01 12:30:45',
    '交易对方': '测试商户',
    '收/支': '支出',
    '金额(元)': '20',
  });

  assert.ok(result.transaction);
  assert.deepEqual(result.transaction.warnings, ['交易状态缺失']);
});
