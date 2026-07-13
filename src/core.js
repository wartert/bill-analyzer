(function initBillAnalyzerCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillAnalyzerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillAnalyzerCore() {
  'use strict';

  const CATEGORY_RULES = [
    {
      id: 'food', name: '餐饮', needType: 'essential', confidence: 0.94,
      keywords: ['餐饮美食', '餐饮', '外卖', '早餐', '午餐', '晚餐', '饭店', '餐厅', '小吃', '食堂', '火锅', '烧烤', '咖啡', '奶茶', '瑞幸', '星巴克', '肯德基', '麦当劳', '美团外卖', '饿了么', '蜜雪冰城'],
    },
    {
      id: 'groceries', name: '日用与商超', needType: 'essential', confidence: 0.9,
      keywords: ['日用百货', '超市', '便利店', '百货', '生鲜', '水果', '蔬菜', '沃尔玛', '永辉', '大润发', '盒马', '山姆'],
    },
    {
      id: 'housing', name: '居住与缴费', needType: 'essential', confidence: 0.94,
      keywords: ['住房物业', '公共服务', '充值缴费', '房租', '租金', '物业', '电费', '水费', '燃气', '宽带', '话费', '手机充值', '生活缴费'],
    },
    {
      id: 'transport', name: '交通出行', needType: 'essential', confidence: 0.93,
      keywords: ['交通出行', '爱车养车', '滴滴', '高德打车', '出租车', '地铁', '公交', '铁路', '12306', '火车票', '机票', '航空', '加油', '停车', 'etc', '客运', '哈啰', '共享单车'],
    },
    {
      id: 'health', name: '医疗健康', needType: 'essential', confidence: 0.95,
      keywords: ['医疗健康', '医院', '药店', '诊所', '体检', '牙科', '眼科', '挂号', '医药', '医保', '社保'],
    },
    {
      id: 'education', name: '教育学习', needType: 'essential', confidence: 0.88,
      keywords: ['教育培训', '学费', '教材', '书店', '图书', '课程', '网课', '培训', '考试', '报名费', '极客时间', '得到'],
    },
    {
      id: 'shopping', name: '购物', needType: 'discretionary', confidence: 0.91,
      keywords: ['服饰装扮', '数码电器', '淘宝', '天猫', '京东', '拼多多', '唯品会', '得物', '闲鱼', '服饰', '鞋靴', '美妆', '护肤', '数码', '家电', '实物商品'],
    },
    {
      id: 'entertainment', name: '娱乐休闲', needType: 'discretionary', confidence: 0.91,
      keywords: ['文化休闲', '电影', '猫眼', 'ktv', '游戏', 'steam', '腾讯视频', '爱奇艺', '优酷', '哔哩哔哩', 'qq音乐', '网易云', '视频会员', '音乐会员', '自动续费', '健身', '台球', '直播'],
    },
    {
      id: 'services', name: '生活服务', needType: 'discretionary', confidence: 0.84,
      keywords: ['生活服务', '商业服务', '理发', '美发', '美容', '洗衣', '家政', '维修', '保洁', '照相', '打印', '快递', '顺丰', '物流'],
    },
    {
      id: 'pets', name: '宠物', needType: 'discretionary', confidence: 0.88,
      keywords: ['宠物', '宠物医院', '宠物用品'],
    },
    {
      id: 'social', name: '转账与人情', needType: 'discretionary', confidence: 0.76,
      keywords: ['转账红包', '微信红包', '群红包', '转账给', '充值至他人', '财付通-转账', '支付宝-转账', '微信转账', '转账', '人情'],
    },
    {
      id: 'offline-qr', name: '线下扫码', needType: 'unclassified', confidence: 0.62,
      keywords: ['扫二维码付款', '二维码付款', '付款码支付'],
    },
  ];

  const FLOW_PATTERNS = {
    refund: /退款|退货退款|退款成功|资金退回|原路退回/iu,
    transfer: /余额宝.{0,8}(转入|转出|自动转入)|小荷包.{0,8}(转入|转出)|零钱充值|转入零钱|本人账户|内部流转|账户互转/iu,
    debt: /信用卡还款|花呗.{0,6}还款|白条.{0,6}还款|借呗.{0,6}还款|贷款还款|还贷|信贷业务待还款/iu,
    asset: /基金|理财|证券|股票|黄金etf|黄金积存|申购|赎回|买入理财|卖出理财/iu,
    salary: /工资|薪资|代发|奖金|绩效|劳务报酬/iu,
    reimbursement: /报销|费用返还/iu,
  };

  function text(value) {
    return value == null ? '' : String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeStatementLineEndings(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  }

  function finiteAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.abs(value) : 0;
    const parsed = Number.parseFloat(text(value).replace(/[,，¥￥\s]/g, ''));
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    }
    const source = text(value);
    const match = source.match(/(20\d{2})[年\/.\-]?(\d{1,2})[月\/.\-]?(\d{1,2})/u);
    if (!match) return source.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  function normalizeTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}:${String(value.getUTCSeconds()).padStart(2, '0')}`;
    }
    const match = text(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/u);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
  }

  function normalizeDirection(value) {
    const source = text(value).toLowerCase();
    if (source === 'income' || /收入|转入|入账|贷/u.test(source)) return 'income';
    if (source === 'neutral' || source === 'internal' || /不计收支|中性|不计/u.test(source)) return 'neutral';
    return 'expense';
  }

  function stableId(tx) {
    const sourceId = text(tx.transactionId || tx.orderId || tx.id);
    if (sourceId) return sourceId;
    return '';
  }

  function normalizeTransaction(input) {
    const source = text(input.source || 'unknown').toLowerCase();
    const date = normalizeDate(input.date || input.datetime || input.timeStamp);
    const timeValue = normalizeTime(input.time || input.datetime || input.timeStamp);
    const merchant = text(input.merchant || input.counterparty || input.payee);
    const description = text(input.description || input.product || input.remark);
    const searchText = text(input.searchText || input.search_text || `${merchant} ${description} ${input.channel || ''} ${input.paymentMethod || ''}`);

    return {
      id: stableId(input),
      transactionId: text(input.transactionId || input.orderId),
      source,
      date,
      time: timeValue,
      datetime: text(input.datetime) || [date, timeValue].filter(Boolean).join(' '),
      amount: finiteAmount(input.amount),
      direction: normalizeDirection(input.direction),
      merchant,
      description,
      searchText,
      channel: text(input.channel),
      paymentMethod: text(input.paymentMethod || input.payment_method),
      status: text(input.status),
      categoryId: text(input.categoryId),
      categoryName: text(input.categoryName),
      flowType: text(input.flowType),
      needType: text(input.needType),
      confidence: Number.isFinite(input.confidence) ? input.confidence : 0,
      ruleId: text(input.ruleId),
      matchedSource: text(input.matchedSource),
      warnings: Array.isArray(input.warnings) ? input.warnings.slice() : [],
      raw: input.raw || null,
    };
  }

  function pick(row, aliases) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias) && text(row[alias]) !== '') return row[alias];
    }
    return '';
  }

  function invalidStatus(status) {
    return /失败|关闭|取消|撤销|未支付|未完成|已作废/iu.test(text(status));
  }

  function rowResult(transaction, status, statusExpected = true) {
    const normalized = normalizeTransaction(transaction);
    if (statusExpected && !text(status)) normalized.warnings.push('交易状态缺失');
    return { transaction: normalized };
  }

  function normalizeWechatRow(row) {
    const status = text(pick(row, ['当前状态', '交易状态', '状态']));
    if (invalidStatus(status)) return { ignoredReason: 'invalid-status' };
    if (/已全额退款/iu.test(status)) return { ignoredReason: 'fully-refunded' };
    if (/对方已退还/iu.test(status)) return { ignoredReason: 'returned-transfer' };

    const timestampValue = pick(row, ['交易时间', '时间', '交易日期']);
    const timestamp = timestampValue instanceof Date ? timestampValue.toISOString().replace('T', ' ').replace('Z', '') : text(timestampValue);
    const type = text(pick(row, ['交易类型', '类型']));
    const merchant = text(pick(row, ['交易对方', '交易商户', '商户名称']));
    const product = text(pick(row, ['商品', '商品说明', '商品名称']));
    const remark = text(pick(row, ['备注', '交易备注']));
    const paymentMethod = text(pick(row, ['支付方式', '收/付款方式']));
    const direction = pick(row, ['收/支', '收支类型', '资金方向']);
    const transactionId = text(pick(row, ['交易单号', '交易订单号', '订单号']));
    const description = [type, product].filter(Boolean).join(' · ');

    const result = rowResult({
      id: transactionId,
      transactionId,
      source: 'wechat',
      date: timestamp,
      time: timestamp,
      datetime: timestamp,
      amount: pick(row, ['金额(元)', '金额', '交易金额']),
      direction,
      merchant,
      description,
      searchText: [type, merchant, product, paymentMethod, status, remark].filter(Boolean).join(' '),
      channel: '微信支付',
      paymentMethod,
      status,
      raw: row,
    }, status);

    const partialRefund = status.match(/已退款[^\d]*([\d,]+(?:\.\d+)?)/u);
    if (partialRefund) {
      const refundAmount = finiteAmount(partialRefund[1]);
      if (refundAmount > 0 && refundAmount < result.transaction.amount) {
        result.adjustments = [normalizeTransaction({
          ...result.transaction,
          id: result.transaction.id ? `${result.transaction.id}:refund` : '',
          transactionId: result.transaction.transactionId ? `${result.transaction.transactionId}:refund` : '',
          direction: 'income',
          amount: refundAmount,
          description: `${result.transaction.description} · 部分退款`,
          searchText: `${result.transaction.searchText} 部分退款`,
          raw: row,
        })];
      }
    }
    if (!result.adjustments) result.adjustments = [];
    return result;
  }

  function normalizeAlipayRow(row) {
    const status = text(pick(row, ['交易状态', '当前状态', '状态']));
    if (invalidStatus(status)) return { ignoredReason: 'invalid-status' };

    const timestamp = text(pick(row, ['交易时间', '时间', '交易日期']));
    const category = text(pick(row, ['交易分类', '交易类型', '类型']));
    const merchant = text(pick(row, ['交易对方', '对方名称', '商户名称']));
    const product = text(pick(row, ['商品说明', '商品名称', '商品']));
    const remark = text(pick(row, ['备注', '交易备注']));
    const paymentMethod = text(pick(row, ['收/付款方式', '支付方式']));
    const direction = pick(row, ['收/支', '收支类型', '资金方向']);
    const transactionId = text(pick(row, ['交易订单号', '交易单号', '订单号']));

    return rowResult({
      id: transactionId,
      transactionId,
      source: 'alipay',
      date: timestamp,
      time: timestamp,
      datetime: timestamp,
      amount: pick(row, ['金额', '金额(元)', '交易金额']),
      direction,
      merchant,
      description: product || category,
      searchText: [category, merchant, product, paymentMethod, status, remark].filter(Boolean).join(' '),
      channel: '支付宝',
      paymentMethod,
      status,
      raw: row,
    }, status);
  }

  function normalizeBankRow(row) {
    const status = text(pick(row, ['交易状态', '当前状态', '状态']));
    if (invalidStatus(status)) return { ignoredReason: 'invalid-status' };

    const date = text(pick(row, ['交易日期', '交易日', '日期', '记账日期']));
    const timeValue = text(pick(row, ['交易时间', '时间', '记账时间']));
    const incomeAmount = finiteAmount(pick(row, ['收入金额', '贷方发生额', '贷方金额']));
    const expenseAmount = finiteAmount(pick(row, ['支出金额', '借方发生额', '借方金额']));
    const genericAmount = finiteAmount(pick(row, ['交易金额', '金额', '交易金额(元)']));
    const explicitDirection = pick(row, ['收支方向', '收支状态', '借贷标志', '交易方向', '收/支']);
    const direction = incomeAmount > 0 ? 'income' : expenseAmount > 0 ? 'expense' : explicitDirection;
    const amount = incomeAmount || expenseAmount || genericAmount;
    const originalMerchant = text(pick(row, ['对方户名', '交易对方', '对方名称', '收款方名称']));
    const description = text(pick(row, ['摘要', '附言', '备注', '用途', '交易说明']));
    const railMerchant = description.match(/(?:财付通|支付宝)[-－:：]\s*([^;；]+)/u);
    const merchant = /财付通|支付宝/u.test(originalMerchant) && railMerchant ? railMerchant[1].trim() : originalMerchant;
    const channel = text(pick(row, ['交易渠道', '渠道', '交易方式', '支付渠道']));
    const paymentMethod = text(pick(row, ['支付方式', '交易卡号', '账户类型'])) || '银行卡';
    const transactionId = text(pick(row, ['流水号', '交易流水号', '交易单号', '业务编号']));
    const timestamp = [date, timeValue].filter(Boolean).join(' ');

    return rowResult({
      id: transactionId,
      transactionId,
      source: 'bank',
      date,
      time: timeValue,
      datetime: timestamp,
      amount,
      direction,
      merchant,
      description,
      searchText: [merchant, originalMerchant, description, channel, paymentMethod, status].filter(Boolean).join(' '),
      channel,
      paymentMethod,
      status,
      raw: row,
    }, status, false);
  }

  const PDF_HEADERS = [
    '交易日期', '交易时间', '金额', '收支状态', '余额', '对方行名',
    '对方户名', '对方账号', '交易渠道', '交易类型', '币种', '附言',
  ];

  function pdfOrientation(item) {
    const transform = item && item.transform || [];
    return Math.abs(Number(transform[1] || 0)) > Math.abs(Number(transform[0] || 0)) ? 'rotated' : 'horizontal';
  }

  function pdfCoordinates(item, orientation) {
    const transform = item && item.transform || [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);
    const scale = Math.max(
      Math.abs(Number(transform[0] || 0)), Math.abs(Number(transform[1] || 0)),
      Math.abs(Number(transform[2] || 0)), Math.abs(Number(transform[3] || 0)), 1,
    );
    return orientation === 'rotated' ? { row: x, column: y, scale } : { row: y, column: x, scale };
  }

  function clusterByRow(items, orientation, tolerance) {
    const sorted = items.slice().sort((left, right) => pdfCoordinates(left, orientation).row - pdfCoordinates(right, orientation).row);
    const clusters = [];
    sorted.forEach((item) => {
      const coordinate = pdfCoordinates(item, orientation).row;
      const current = clusters[clusters.length - 1];
      if (!current || Math.abs(coordinate - current.center) > tolerance) {
        clusters.push({ center: coordinate, items: [item] });
        return;
      }
      current.items.push(item);
      current.center = current.items.reduce((sum, entry) => sum + pdfCoordinates(entry, orientation).row, 0) / current.items.length;
    });
    return clusters;
  }

  function extractPdfTableRows(items) {
    const meaningful = (items || []).filter((item) => text(item && item.str));
    const dateHeader = meaningful.find((item) => text(item.str) === '交易日期');
    if (!dateHeader) return [];
    const orientation = pdfOrientation(dateHeader);
    const oriented = meaningful.filter((item) => pdfOrientation(item) === orientation);
    const headerCandidates = oriented.filter((item) => PDF_HEADERS.includes(text(item.str)));
    const headerTolerance = pdfCoordinates(dateHeader, orientation).scale * 1.4;
    const headerClusters = clusterByRow(headerCandidates, orientation, headerTolerance)
      .sort((left, right) => new Set(right.items.map((item) => text(item.str))).size - new Set(left.items.map((item) => text(item.str))).size);
    const headerCluster = headerClusters[0];
    if (!headerCluster) return [];

    const headerColumns = headerCluster.items
      .map((item) => ({ name: text(item.str), column: pdfCoordinates(item, orientation).column }))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index)
      .sort((left, right) => left.column - right.column);
    if (!['交易日期', '交易时间', '金额', '收支状态'].every((name) => headerColumns.some((column) => column.name === name))) return [];

    const headerRow = headerCluster.center;
    const dateAnchors = oriented.filter((item) => /^20\d{6}$/u.test(text(item.str)));
    const greater = dateAnchors.filter((item) => pdfCoordinates(item, orientation).row > headerRow + headerTolerance);
    const lesser = dateAnchors.filter((item) => pdfCoordinates(item, orientation).row < headerRow - headerTolerance);
    const likelyRows = greater.length > lesser.length ? greater : lesser.length > greater.length ? lesser : orientation === 'rotated' ? greater : lesser;
    const anchorClusters = clusterByRow(likelyRows, orientation, Math.max(2, pdfCoordinates(dateHeader, orientation).scale * 0.65));

    return anchorClusters.map((cluster) => {
      const anchor = cluster.items[0];
      const anchorCoordinate = pdfCoordinates(anchor, orientation);
      const rowTolerance = Math.max(4, anchorCoordinate.scale * 1.35);
      const rowItems = oriented
        .filter((item) => Math.abs(pdfCoordinates(item, orientation).row - cluster.center) <= rowTolerance)
        .filter((item) => !PDF_HEADERS.includes(text(item.str)));
      const cells = new Map(headerColumns.map((column) => [column.name, []]));

      rowItems.forEach((item) => {
        const coordinate = pdfCoordinates(item, orientation);
        const nearest = headerColumns.reduce((best, column) => (
          Math.abs(column.column - coordinate.column) < Math.abs(best.column - coordinate.column) ? column : best
        ), headerColumns[0]);
        cells.get(nearest.name).push({ item, row: coordinate.row, column: coordinate.column });
      });

      const row = {};
      headerColumns.forEach((column) => {
        const values = cells.get(column.name)
          .sort((left, right) => left.row - right.row || left.column - right.column)
          .map((entry) => text(entry.item.str))
          .filter(Boolean);
        row[column.name] = values.join(';').replace(/;{2,}/g, ';').trim();
      });
      return row;
    }).filter((row) => /^20\d{6}$/u.test(row['交易日期']) && finiteAmount(row['金额']) > 0);
  }

  function applyFlow(tx, flowType, categoryId, categoryName, ruleId, confidence, needType = 'not-applicable') {
    return {
      ...tx,
      flowType,
      categoryId,
      categoryName,
      needType,
      ruleId,
      confidence,
    };
  }

  function containsKeyword(source, keyword) {
    return source.includes(keyword.toLowerCase());
  }

  function classifyTransaction(input) {
    const tx = normalizeTransaction(input);
    const source = tx.searchText.toLowerCase();

    if (FLOW_PATTERNS.refund.test(source)) {
      return applyFlow(tx, 'refund', 'refund', '退款', 'flow:refund', 0.98);
    }
    if (FLOW_PATTERNS.transfer.test(source)) {
      return applyFlow(tx, 'transfer', 'internal-transfer', '内部流转', 'flow:transfer', 0.96);
    }
    if (FLOW_PATTERNS.debt.test(source)) {
      return applyFlow(tx, 'debt', 'debt-repayment', '债务偿还', 'flow:debt', 0.96);
    }
    if (FLOW_PATTERNS.asset.test(source)) {
      return applyFlow(tx, 'asset', 'asset-investment', '资产变动', 'flow:asset', 0.94);
    }
    if (tx.direction === 'income') {
      if (FLOW_PATTERNS.salary.test(source)) {
        return applyFlow(tx, 'income', 'salary', '工资与劳务收入', 'income:salary', 0.96);
      }
      if (FLOW_PATTERNS.reimbursement.test(source)) {
        return applyFlow(tx, 'income', 'reimbursement', '报销收入', 'income:reimbursement', 0.91);
      }
      return applyFlow(tx, 'income', 'other-income', '其他收入', 'income:fallback', 0.55);
    }
    if (tx.direction === 'neutral') {
      return applyFlow(tx, 'transfer', 'unclear-neutral', '不计收支', 'flow:neutral-fallback', 0.5);
    }

    for (const rule of CATEGORY_RULES) {
      const keyword = rule.keywords
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((candidate) => containsKeyword(source, candidate));
      if (keyword) {
        return applyFlow(tx, 'expense', rule.id, rule.name, `category:${rule.id}:${keyword}`, rule.confidence, rule.needType);
      }
    }

    return applyFlow(tx, 'expense', 'unclassified', '待确认', 'category:fallback', 0.25, 'unclassified');
  }

  function seconds(value) {
    if (!/^\d{2}:\d{2}:\d{2}$/u.test(value)) return null;
    const [hour, minute, second] = value.split(':').map(Number);
    return hour * 3600 + minute * 60 + second;
  }

  function cents(value) {
    return Math.round(finiteAmount(value) * 100);
  }

  function compatibleDetailSources(bankTransaction) {
    const source = `${bankTransaction.channel} ${bankTransaction.merchant} ${bankTransaction.searchText}`.toLowerCase();
    const result = new Set();
    if (/微信|财付通|wechat/u.test(source)) result.add('wechat');
    if (/支付宝|alipay/u.test(source)) result.add('alipay');
    if (/银联|网联/u.test(source) && result.size === 0) {
      result.add('wechat');
      result.add('alipay');
    }
    return result;
  }

  function linkCandidate(bankTransaction, candidates) {
    if (candidates.length === 1) return { match: candidates[0], ambiguous: false };
    const bankSeconds = seconds(bankTransaction.time);
    if (bankSeconds == null) return { match: null, ambiguous: candidates.length > 1 };

    const timed = candidates
      .map((candidate) => {
        const candidateSeconds = seconds(candidate.time);
        return { candidate, diff: candidateSeconds == null ? null : Math.abs(bankSeconds - candidateSeconds) };
      })
      .filter((item) => item.diff != null && item.diff <= 10)
      .sort((a, b) => a.diff - b.diff);

    if (timed.length === 1 || (timed.length > 1 && timed[0].diff < timed[1].diff)) {
      return { match: timed[0].candidate, ambiguous: false };
    }
    return { match: null, ambiguous: candidates.length > 1 };
  }

  function reconcileTransactions(records) {
    const normalized = records.map(normalizeTransaction);
    const unique = [];
    const exactIds = new Set();
    let sameSourceDuplicates = 0;

    for (const item of normalized) {
      const exactKey = item.id ? `${item.source}|${item.id}` : '';
      if (exactKey && exactIds.has(exactKey)) {
        sameSourceDuplicates += 1;
        continue;
      }
      if (exactKey) exactIds.add(exactKey);
      unique.push(item);
    }

    const removed = new Set();
    let matchedPairs = 0;
    let ambiguousMatches = 0;

    unique.forEach((bankItem, bankIndex) => {
      if (bankItem.source !== 'bank' || bankItem.direction !== 'expense' || removed.has(bankIndex)) return;
      const compatible = compatibleDetailSources(bankItem);
      if (compatible.size === 0) return;

      const candidates = unique
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate, index }) => (
          !removed.has(index)
          && compatible.has(candidate.source)
          && candidate.date === bankItem.date
          && cents(candidate.amount) === cents(bankItem.amount)
        ));

      if (candidates.length === 0) return;
      const decision = linkCandidate(bankItem, candidates.map((item) => item.candidate));
      if (!decision.match) {
        if (decision.ambiguous) {
          ambiguousMatches += 1;
          bankItem.warnings.push('存在多笔同金额候选，未自动去重');
        }
        return;
      }

      const matched = candidates.find((item) => item.candidate === decision.match);
      if (!matched) return;
      removed.add(bankIndex);
      decision.match.matchedSource = 'bank';
      matchedPairs += 1;
    });

    return {
      transactions: unique.filter((_, index) => !removed.has(index)),
      quality: {
        rawRecords: records.length,
        validRecords: unique.length - removed.size,
        matchedPairs,
        ambiguousMatches,
        sameSourceDuplicates,
        ignoredRecords: 0,
      },
    };
  }

  function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function roundOne(value) {
    return Math.round((value + Number.EPSILON) * 10) / 10;
  }

  function parseDay(value) {
    if (!/^20\d{2}-\d{2}-\d{2}$/u.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function monthKey(value) {
    return /^20\d{2}-\d{2}/u.test(value) ? value.slice(0, 7) : '日期待确认';
  }

  function groupBy(items, keyOf) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function aggregateCategories(expenses, grossExpense) {
    return Array.from(groupBy(expenses, (item) => item.categoryId).entries())
      .map(([id, items]) => {
        const amount = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
        return {
          id,
          name: items[0].categoryName,
          needType: items[0].needType,
          amount,
          count: items.length,
          average: roundMoney(amount / items.length),
          share: grossExpense > 0 ? roundOne((amount / grossExpense) * 100) : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }

  function aggregateNeed(expenses, grossExpense) {
    const totals = { essential: 0, discretionary: 0, unclassified: 0 };
    expenses.forEach((item) => { totals[item.needType] = (totals[item.needType] || 0) + item.amount; });
    return Object.entries(totals).map(([type, value]) => ({
      type,
      amount: roundMoney(value),
      share: grossExpense > 0 ? roundOne((value / grossExpense) * 100) : 0,
    }));
  }

  function aggregateMonthly(transactions) {
    const months = new Map();
    transactions.forEach((item) => {
      const key = monthKey(item.date);
      if (!months.has(key)) months.set(key, { month: key, income: 0, grossExpense: 0, refunds: 0, asset: 0, debt: 0, transfer: 0 });
      const bucket = months.get(key);
      if (item.flowType === 'income') bucket.income += item.amount;
      if (item.flowType === 'expense') bucket.grossExpense += item.amount;
      if (item.flowType === 'refund') bucket.refunds += item.amount;
      if (item.flowType === 'asset') bucket.asset += item.amount;
      if (item.flowType === 'debt') bucket.debt += item.amount;
      if (item.flowType === 'transfer') bucket.transfer += item.amount;
    });
    return Array.from(months.values())
      .map((bucket) => ({
        ...bucket,
        income: roundMoney(bucket.income),
        grossExpense: roundMoney(bucket.grossExpense),
        refunds: roundMoney(bucket.refunds),
        netExpense: roundMoney(bucket.grossExpense - bucket.refunds),
        balance: roundMoney(bucket.income - (bucket.grossExpense - bucket.refunds)),
        asset: roundMoney(bucket.asset), debt: roundMoney(bucket.debt), transfer: roundMoney(bucket.transfer),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  function aggregateMerchants(expenses) {
    return Array.from(groupBy(expenses, (item) => item.merchant || '商户待确认').entries())
      .map(([name, items]) => ({
        name,
        amount: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
        count: items.length,
        months: new Set(items.map((item) => monthKey(item.date))).size,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  function recurringCandidates(expenses) {
    return aggregateMerchants(expenses)
      .filter((item) => item.months >= 3 && item.count >= 3)
      .map((item) => ({ ...item, label: '周期性消费候选' }))
      .slice(0, 12);
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function anomalyTransactions(expenses) {
    if (expenses.length < 5) return expenses.slice().sort((a, b) => b.amount - a.amount).slice(0, 3);
    const center = median(expenses.map((item) => item.amount));
    const mad = median(expenses.map((item) => Math.abs(item.amount - center)));
    const threshold = Math.max(center * 3, center + 4 * mad);
    return expenses.filter((item) => item.amount >= threshold).sort((a, b) => b.amount - a.amount).slice(0, 12);
  }

  function changeDrivers(transactions) {
    const months = aggregateMonthly(transactions).filter((item) => item.month !== '日期待确认');
    if (months.length < 2) return [];
    const currentMonth = months[months.length - 1].month;
    const previousMonth = months[months.length - 2].month;
    const categories = new Map();
    transactions.filter((item) => item.flowType === 'expense' && [currentMonth, previousMonth].includes(monthKey(item.date)))
      .forEach((item) => {
        if (!categories.has(item.categoryId)) categories.set(item.categoryId, { id: item.categoryId, name: item.categoryName, current: 0, previous: 0 });
        categories.get(item.categoryId)[monthKey(item.date) === currentMonth ? 'current' : 'previous'] += item.amount;
      });
    return Array.from(categories.values())
      .map((item) => ({ ...item, change: roundMoney(item.current - item.previous), current: roundMoney(item.current), previous: roundMoney(item.previous) }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 3);
  }

  function analyzeTransactions(records) {
    const reconciled = reconcileTransactions(records);
    const transactions = reconciled.transactions.map(classifyTransaction);
    const income = transactions.filter((item) => item.flowType === 'income');
    const expenses = transactions.filter((item) => item.flowType === 'expense');
    const refunds = transactions.filter((item) => item.flowType === 'refund');
    const assets = transactions.filter((item) => item.flowType === 'asset');
    const debts = transactions.filter((item) => item.flowType === 'debt');
    const transfers = transactions.filter((item) => item.flowType === 'transfer');
    const validDates = transactions.map((item) => item.date).filter((value) => parseDay(value)).sort();
    const firstDate = validDates[0] || '';
    const lastDate = validDates[validDates.length - 1] || '';
    const firstDay = parseDay(firstDate);
    const lastDay = parseDay(lastDate);
    const coverageDays = firstDay && lastDay ? Math.max(1, Math.round((lastDay - firstDay) / 86400000) + 1) : 1;
    const totalIncome = roundMoney(income.reduce((sum, item) => sum + item.amount, 0));
    const grossExpense = roundMoney(expenses.reduce((sum, item) => sum + item.amount, 0));
    const refundTotal = roundMoney(refunds.reduce((sum, item) => sum + item.amount, 0));
    const netExpense = roundMoney(grossExpense - refundTotal);
    const cashBalance = roundMoney(totalIncome - netExpense);
    const unclassifiedCount = expenses.filter((item) => item.needType === 'unclassified').length;

    const analysis = {
      meta: {
        firstDate,
        lastDate,
        dateRange: firstDate && lastDate ? `${firstDate} — ${lastDate}` : '日期待确认',
        coverageDays,
        sourceCounts: Object.fromEntries(Array.from(groupBy(transactions, (item) => item.source).entries()).map(([key, items]) => [key, items.length])),
      },
      quality: {
        ...reconciled.quality,
        unclassifiedCount,
        unclassifiedRate: expenses.length ? roundOne((unclassifiedCount / expenses.length) * 100) : 0,
        warningCount: transactions.reduce((sum, item) => sum + item.warnings.length, 0),
      },
      summary: {
        totalIncome,
        grossExpense,
        refunds: refundTotal,
        netExpense,
        cashBalance,
        savingsRate: totalIncome > 0 ? roundOne((cashBalance / totalIncome) * 100) : null,
        dailyAverage: roundMoney(netExpense / coverageDays),
        assetFlow: roundMoney(assets.reduce((sum, item) => sum + item.amount, 0)),
        debtFlow: roundMoney(debts.reduce((sum, item) => sum + item.amount, 0)),
        transferFlow: roundMoney(transfers.reduce((sum, item) => sum + item.amount, 0)),
        incomeCount: income.length,
        expenseCount: expenses.length,
        refundCount: refunds.length,
      },
      categories: aggregateCategories(expenses, grossExpense),
      needStructure: aggregateNeed(expenses, grossExpense),
      monthly: aggregateMonthly(transactions),
      changeDrivers: changeDrivers(transactions),
      merchants: aggregateMerchants(expenses).slice(0, 20),
      recurringCandidates: recurringCandidates(expenses),
      anomalies: anomalyTransactions(expenses),
      transactions: transactions.slice().sort((a, b) => b.datetime.localeCompare(a.datetime)),
    };
    analysis.recommendations = buildRecommendations(analysis);
    return analysis;
  }

  function money(value) {
    return `¥${roundMoney(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function buildRecommendations(analysis) {
    const recommendations = [];
    const { quality, summary, categories, needStructure } = analysis;

    if (quality.unclassifiedRate >= 10) {
      recommendations.push({
        id: 'data-quality', tone: 'attention', title: '先提高分类可信度',
        evidence: `${quality.unclassifiedCount} 笔消费待确认，占消费笔数 ${quality.unclassifiedRate}%`,
        impact: '未分类记录较多时，分类占比和后续建议可能偏离真实情况。',
        action: '优先核对金额较大的待确认记录，再据此调整分类判断。',
      });
    }

    if (summary.totalIncome > 0 && summary.cashBalance < 0) {
      recommendations.push({
        id: 'negative-cashflow', tone: 'attention', title: '本期现金结余为负',
        evidence: `真实收入 ${money(summary.totalIncome)}，净消费 ${money(summary.netExpense)}，相差 ${money(Math.abs(summary.cashBalance))}`,
        impact: '如果连续多个完整月份如此，现金缓冲会逐步减少。',
        action: '先检查一次性大额项目和可选支出，再为下个完整月设置可执行的支出上限。',
      });
    } else if (summary.totalIncome > 0) {
      recommendations.push({
        id: 'cashflow', tone: 'positive', title: '现金流保持结余',
        evidence: `本期现金结余 ${money(summary.cashBalance)}，占真实收入 ${summary.savingsRate}%`,
        impact: '稳定的正结余能提高应对临时支出的弹性。',
        action: '结合覆盖月份核对这是否为常态，并预留一笔容易取用的日常缓冲。',
      });
    }

    const discretionary = needStructure.find((item) => item.type === 'discretionary');
    if (discretionary && discretionary.amount > 0) {
      recommendations.push({
        id: 'discretionary', tone: discretionary.share >= 40 ? 'attention' : 'neutral', title: '可选消费是最灵活的调整空间',
        evidence: `可选消费 ${money(discretionary.amount)}，占消费 ${discretionary.share}%`,
        impact: '这部分通常比房租、通勤和基础生活更容易短期调整。',
        action: '从金额最高的一个可选分类开始，判断哪些支出值得保留、延后或减少频率。',
      });
    }

    const topCategory = categories[0];
    if (topCategory) {
      recommendations.push({
        id: 'top-category', tone: 'neutral', title: `${topCategory.name}是本期最大消费去向`,
        evidence: `${topCategory.count} 笔，共 ${money(topCategory.amount)}，占消费 ${topCategory.share}%`,
        impact: '最大分类的少量变化，往往比削减零散小额支出更明显。',
        action: `查看${topCategory.name}中金额最高和频率最高的交易，确认是否符合你的实际优先级。`,
      });
    }

    if (analysis.recurringCandidates.length) {
      const candidate = analysis.recurringCandidates[0];
      recommendations.push({
        id: 'recurring', tone: 'neutral', title: '发现周期性消费候选',
        evidence: `${candidate.name} 在 ${candidate.months} 个月出现 ${candidate.count} 次，累计 ${money(candidate.amount)}`,
        impact: '它可能是订阅、固定服务，也可能只是高频日常消费，需要人工确认。',
        action: '核对是否仍在使用；若不是订阅，则保留为高频消费观察项。',
      });
    }

    if (!recommendations.length) {
      recommendations.push({
        id: 'insufficient-data', tone: 'neutral', title: '先积累更完整的账单周期',
        evidence: `当前识别到 ${analysis.transactions.length} 笔有效记录`,
        impact: '数据过少时，趋势和周期性判断容易受到单笔交易影响。',
        action: '补充至少一个完整月的账单，再比较分类和月度变化。',
      });
    }

    return recommendations.slice(0, 6);
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  return {
    CATEGORY_RULES,
    analyzeTransactions,
    buildRecommendations,
    classifyTransaction,
    escapeHtml,
    extractPdfTableRows,
    normalizeDate,
    normalizeAlipayRow,
    normalizeBankRow,
    normalizeDirection,
    normalizeStatementLineEndings,
    normalizeTime,
    normalizeTransaction,
    normalizeWechatRow,
    reconcileTransactions,
  };
});
