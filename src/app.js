(function bootstrapMoneyWhere() {
  'use strict';

  const Core = window.BillAnalyzerCore;
  const SOURCE_META = {
    bank: { label: '银行卡', icon: null },
    wechat: { label: '微信支付', icon: 'assets/brands/wechatpay.svg' },
    alipay: { label: '支付宝', icon: 'assets/brands/alipay.svg' },
  };
  const FILE_SIZE_LIMIT_MIB = {
    csv: 15,
    xls: 20,
    xlsx: 20,
    pdf: 30,
  };
  const TOTAL_SELECTED_FILE_LIMIT_MIB = 40;
  const FLOW_META = {
    expense: { label: '消费', sign: '−' },
    income: { label: '收入', sign: '+' },
    refund: { label: '退款', sign: '+' },
    transfer: { label: '内部流转', sign: '↔' },
    asset: { label: '资产变动', sign: '↔' },
    debt: { label: '债务偿还', sign: '↔' },
  };
  const STATE = {
    files: { bank: null, wechat: null, alipay: null },
    analysis: null,
    charts: [],
  };

  const elements = {
    form: document.getElementById('upload-form'),
    analyzeButton: document.getElementById('analyze-button'),
    sampleButton: document.getElementById('sample-button'),
    resetButton: document.getElementById('reset-button'),
    printButton: document.getElementById('print-button'),
    selectedCount: document.getElementById('selected-count'),
    progress: document.getElementById('progress'),
    report: document.getElementById('report'),
    search: document.getElementById('transaction-search'),
    flowFilter: document.getElementById('flow-filter'),
    sourceFilter: document.getElementById('source-filter'),
    categoryFilter: document.getElementById('category-filter'),
  };

  if (!Core) {
    setProgress('核心分析模块未能加载，请确认项目文件完整。', true);
    return;
  }

  configurePdfWorker();
  bindUploadInputs();
  bindActions();

  function configurePdfWorker() {
    if (!window.pdfjsLib || !window.pdfjsLib.GlobalWorkerOptions) return;
    if (window.__BILL_ANALYZER_PDF_WORKER_PORT__) {
      window.pdfjsLib.GlobalWorkerOptions.workerPort = window.__BILL_ANALYZER_PDF_WORKER_PORT__;
      return;
    }
    if (window.__BILL_ANALYZER_PDF_WORKER_URL__) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.__BILL_ANALYZER_PDF_WORKER_URL__;
      return;
    }
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', window.location.href).href;
    } catch (_) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
    }
  }

  function bindUploadInputs() {
    Object.keys(SOURCE_META).forEach((source) => {
      const input = document.getElementById(`${source}-file`);
      const container = document.querySelector(`[data-source="${source}"]`);
      const card = container.querySelector('.upload-card');

      input.addEventListener('change', () => {
        if (input.files && input.files[0]) selectFile(source, input.files[0]);
      });

      ['dragenter', 'dragover'].forEach((eventName) => {
        card.addEventListener(eventName, (event) => {
          event.preventDefault();
          container.classList.add('is-dragging');
        });
      });
      ['dragleave', 'drop'].forEach((eventName) => {
        card.addEventListener(eventName, (event) => {
          event.preventDefault();
          container.classList.remove('is-dragging');
        });
      });
      card.addEventListener('drop', (event) => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) selectFile(source, file);
      });
    });

    document.querySelectorAll('[data-clear]').forEach((button) => {
      button.addEventListener('click', () => clearFile(button.dataset.clear));
    });
  }

  function bindActions() {
    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      runUploadedAnalysis();
    });
    elements.sampleButton.addEventListener('click', runSampleAnalysis);
    elements.resetButton.addEventListener('click', resetApplication);
    elements.printButton.addEventListener('click', () => window.print());
    [elements.search, elements.flowFilter, elements.sourceFilter, elements.categoryFilter].forEach((control) => {
      control.addEventListener(control === elements.search ? 'input' : 'change', renderTransactions);
    });
    window.addEventListener('resize', () => STATE.charts.forEach((chart) => chart.resize()));
  }

  function selectFile(source, file) {
    const error = validateFile(source, file);
    if (error) {
      setProgress(error, true);
      return;
    }
    STATE.files[source] = file;
    const container = document.querySelector(`[data-source="${source}"]`);
    container.classList.add('is-ready');
    const status = document.getElementById(`${source}-status`);
    status.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    container.querySelector('[data-clear]').hidden = false;
    if (source === 'bank') {
      document.getElementById('bank-password-wrap').hidden = !file.name.toLowerCase().endsWith('.pdf');
    }
    setProgress('');
    updateFileSummary();
  }

  function validateFile(source, file) {
    const extension = file.name.toLowerCase().split('.').pop();
    const allowed = source === 'bank' ? ['pdf', 'csv'] : source === 'wechat' ? ['xlsx', 'xls'] : ['csv'];
    if (!allowed.includes(extension)) return `${SOURCE_META[source].label}不支持 .${extension || '未知'} 文件，请选择 ${allowed.join(' / ').toUpperCase()}。`;
    const limitMiB = FILE_SIZE_LIMIT_MIB[extension];
    if (file.size > limitMiB * 1024 * 1024) return `${file.name} 超过 ${extension.toUpperCase()} 的 ${limitMiB} MiB 限制，请导出更短的日期范围后重新导入。`;
    return '';
  }

  function clearFile(source) {
    STATE.files[source] = null;
    const container = document.querySelector(`[data-source="${source}"]`);
    container.classList.remove('is-ready');
    const input = document.getElementById(`${source}-file`);
    input.value = '';
    document.getElementById(`${source}-status`).textContent = '尚未选择';
    container.querySelector('[data-clear]').hidden = true;
    if (source === 'bank') {
      document.getElementById('bank-password-wrap').hidden = true;
      document.getElementById('bank-password').value = '';
    }
    updateFileSummary();
  }

  function updateFileSummary() {
    const count = Object.values(STATE.files).filter(Boolean).length;
    elements.selectedCount.textContent = `${count} 个文件`;
    elements.analyzeButton.disabled = count === 0;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function setProgress(message, isError = false) {
    elements.progress.textContent = message;
    elements.progress.classList.toggle('is-error', Boolean(isError));
  }

  async function runUploadedAnalysis() {
    const selected = Object.entries(STATE.files).filter(([, file]) => file);
    if (!selected.length) return;
    const totalSelectedBytes = selected.reduce((total, [, file]) => total + file.size, 0);
    if (totalSelectedBytes > TOTAL_SELECTED_FILE_LIMIT_MIB * 1024 * 1024) {
      setProgress(`所选文件合计超过 ${TOTAL_SELECTED_FILE_LIMIT_MIB} MiB 限制，请移除部分文件，或导出更短的日期范围后重新导入。`, true);
      return;
    }

    setBusy(true);
    setProgress('正在读取账单文件…');
    try {
      const parsed = [];
      for (const [source, file] of selected) {
        parsed.push(await parseSourceFile(source, file));
      }
      const records = parsed.flatMap((result) => result.records);
      const parseStats = combineParseStats(parsed);
      if (!records.length) throw new Error('没有识别到有效交易，请确认文件来自官方账单导出并包含交易明细。');
      setProgress(`已识别 ${records.length} 条有效记录，正在统一口径与跨平台去重…`);
      await nextFrame();
      const analysis = Core.analyzeTransactions(records);
      applyParseStats(analysis, parseStats);
      showReport(analysis);
      setProgress('');
    } catch (error) {
      console.error(error);
      setProgress(normalizeError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function runSampleAnalysis() {
    setBusy(true);
    setProgress('正在生成脱敏示例报告…');
    window.setTimeout(() => {
      try {
        const records = createSampleRecords();
        const analysis = Core.analyzeTransactions(records);
        analysis.meta.isSample = true;
        showReport(analysis);
        setProgress('');
      } finally {
        setBusy(false);
      }
    }, 80);
  }

  function setBusy(isBusy) {
    elements.analyzeButton.disabled = isBusy || !Object.values(STATE.files).some(Boolean);
    elements.sampleButton.disabled = isBusy;
    elements.analyzeButton.setAttribute('aria-busy', String(isBusy));
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  async function parseSourceFile(source, file) {
    if (source === 'wechat') return parseWechatWorkbook(file);
    if (source === 'alipay') return parseDelimitedStatement(file, 'alipay');
    if (file.name.toLowerCase().endsWith('.pdf')) return parseBankPdf(file);
    return parseDelimitedStatement(file, 'bank');
  }

  function combineParseStats(results) {
    return results.reduce((total, result) => ({
      rawRows: total.rawRows + result.stats.rawRows,
      ignoredRecords: total.ignoredRecords + result.stats.ignoredRecords,
      malformedRecords: total.malformedRecords + result.stats.malformedRecords,
      fullyRefunded: total.fullyRefunded + result.stats.fullyRefunded,
      returnedTransfers: total.returnedTransfers + result.stats.returnedTransfers,
    }), { rawRows: 0, ignoredRecords: 0, malformedRecords: 0, fullyRefunded: 0, returnedTransfers: 0 });
  }

  function applyParseStats(analysis, stats) {
    analysis.quality.rawRecords = stats.rawRows;
    analysis.quality.validRecords = analysis.transactions.length;
    analysis.quality.ignoredRecords = stats.ignoredRecords;
    analysis.quality.malformedRecords = stats.malformedRecords;
    analysis.quality.fullyRefunded = stats.fullyRefunded;
    analysis.quality.returnedTransfers = stats.returnedTransfers;
  }

  async function readTextWithEncoding(file, expectedHeader) {
    const buffer = await file.arrayBuffer();
    const candidates = ['utf-8', 'gb18030'];
    let best = '';
    let bestScore = -Infinity;
    candidates.forEach((encoding) => {
      try {
        const decoded = new TextDecoder(encoding).decode(buffer);
        const score = (decoded.includes(expectedHeader) ? 1000 : 0) - (decoded.match(/�/g) || []).length;
        if (score > bestScore) {
          best = decoded;
          bestScore = score;
        }
      } catch (_) {
        // Unsupported encodings are skipped; modern browsers support both candidates.
      }
    });
    return Core.normalizeStatementLineEndings(best.replace(/^\uFEFF/u, ''));
  }

  async function parseDelimitedStatement(file, source) {
    if (!window.Papa) throw new Error('CSV 解析组件未加载。');
    const csvText = await readTextWithEncoding(file, '交易时间');
    const parsed = window.Papa.parse(csvText, { header: false, skipEmptyLines: false });
    if (parsed.errors && parsed.errors.length && !parsed.data.length) throw new Error(`CSV 读取失败：${parsed.errors[0].message}`);
    const table = parsed.data;
    const headerIndex = findHeaderIndex(table, source === 'alipay' ? ['交易时间', '交易对方', '金额'] : ['交易日期']);
    if (headerIndex < 0) throw new Error(`${SOURCE_META[source].label}文件中没有找到可识别的表头。`);
    const headers = table[headerIndex].map((value) => String(value || '').trim());
    const normalizer = source === 'alipay' ? Core.normalizeAlipayRow : Core.normalizeBankRow;
    return normalizeTableRows(table.slice(headerIndex + 1), headers, normalizer);
  }

  async function parseWechatWorkbook(file) {
    if (!window.XLSX) throw new Error('XLSX 解析组件未加载。');
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const table = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerIndex = findHeaderIndex(table, ['交易时间', '交易类型', '金额(元)']);
    if (headerIndex < 0) throw new Error('微信支付文件中没有找到官方交易明细表头。');
    const headers = table[headerIndex].map((value) => String(value || '').trim());
    return normalizeTableRows(table.slice(headerIndex + 1), headers, Core.normalizeWechatRow);
  }

  function findHeaderIndex(rows, requiredColumns) {
    return rows.findIndex((row) => {
      const values = row.map((value) => String(value || '').trim());
      return requiredColumns.every((column) => values.includes(column));
    });
  }

  function normalizeTableRows(rows, headers, normalizer) {
    const records = [];
    const stats = { rawRows: 0, ignoredRecords: 0, malformedRecords: 0, fullyRefunded: 0, returnedTransfers: 0 };
    rows.forEach((values) => {
      if (!Array.isArray(values) || values.every((value) => String(value || '').trim() === '')) return;
      if (String(values[0] || '').includes('----------------')) return;
      const row = {};
      headers.forEach((header, index) => { if (header) row[header] = values[index] == null ? '' : values[index]; });
      stats.rawRows += 1;
      const result = normalizer(row);
      if (result.ignoredReason) {
        stats.ignoredRecords += 1;
        if (result.ignoredReason === 'fully-refunded') stats.fullyRefunded += 1;
        if (result.ignoredReason === 'returned-transfer') stats.returnedTransfers += 1;
        return;
      }
      if (!result.transaction || !result.transaction.date || result.transaction.amount <= 0) {
        stats.malformedRecords += 1;
        return;
      }
      records.push(result.transaction);
      if (result.adjustments) records.push(...result.adjustments);
    });
    return { records, stats };
  }

  async function parseBankPdf(file) {
    if (!window.pdfjsLib || !window.pdfjsLib.getDocument) throw new Error('PDF 解析组件未加载。');
    const data = new Uint8Array(await file.arrayBuffer());
    const password = document.getElementById('bank-password').value || undefined;
    let documentTask;
    try {
      documentTask = window.pdfjsLib.getDocument({ data, password, isEvalSupported: false, useSystemFonts: true });
      const pdf = await documentTask.promise;
      const records = [];
      let rawRows = 0;
      let malformedRecords = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        setProgress(`正在解析银行 PDF：第 ${pageNumber} / ${pdf.numPages} 页…`);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const tableRows = Core.extractPdfTableRows(content.items);
        if (tableRows.length) {
          rawRows += tableRows.length;
          tableRows.forEach((row) => {
            const result = Core.normalizeBankRow(row);
            if (result.transaction && result.transaction.date && result.transaction.amount > 0) records.push(result.transaction);
            else malformedRecords += 1;
          });
        } else {
          const lines = groupPdfLines(content.items);
          lines.forEach((line) => {
            if (!/^20\d{6}\s+\d{2}:\d{2}:\d{2}/u.test(line)) return;
            rawRows += 1;
            const normalized = parsePdfTransactionLine(line);
            if (normalized) records.push(normalized);
            else malformedRecords += 1;
          });
        }
      }
      if (!records.length) throw new Error('PDF 有文本内容，但没有识别到交易行。可优先从银行 App 导出 CSV，或确认 PDF 版式包含交易日期、时间、金额和收支方向。');
      return { records, stats: { rawRows, ignoredRecords: 0, malformedRecords, fullyRefunded: 0, returnedTransfers: 0 } };
    } catch (error) {
      const message = String(error && error.message || error);
      if (/password|密码/iu.test(message) || error && error.name === 'PasswordException') {
        throw new Error('银行 PDF 需要正确的打开密码。密码只在本次解析中使用，不会保存。');
      }
      throw error;
    } finally {
      if (documentTask && typeof documentTask.destroy === 'function') documentTask.destroy();
    }
  }

  function groupPdfLines(items) {
    const groups = new Map();
    items.forEach((item) => {
      const y = Math.round(Number(item.transform && item.transform[5] || 0) * 2) / 2;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push({ x: Number(item.transform && item.transform[4] || 0), value: String(item.str || '').trim() });
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.value).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  }

  function parsePdfTransactionLine(line) {
    const match = line.match(/^(20\d{6})\s+(\d{2}:\d{2}:\d{2})\s+([\d,]+(?:\.\d+)?)\s+(收入|支出|贷|借)\s+(.*)$/u);
    if (!match) return null;
    const [, date, time, amount, direction, tail] = match;
    const narrative = tail
      .replace(/\b[\d,]+\.\d{2}\b/u, '')
      .replace(/\b\d{12,}\b/gu, '')
      .replace(/\b(?:CNY|RMB|人民币)\b/giu, '')
      .replace(/\s+/g, ' ')
      .trim();
    const pieces = narrative.split(/[;；]/u).map((value) => value.trim()).filter(Boolean);
    return Core.normalizeBankRow({
      '交易日期': date,
      '交易时间': time,
      '金额': amount,
      '收支状态': /收入|贷/u.test(direction) ? '收入' : '支出',
      '对方户名': pieces[0] || '交易对方待确认',
      '附言': narrative,
    }).transaction;
  }

  function normalizeError(error) {
    const message = String(error && error.message || error || '未知错误');
    if (/worker|module script|CORS/iu.test(message)) return 'PDF 解析组件被浏览器安全策略拦截，请通过 README 中的本地启动方式打开工具后重试。';
    return `分析失败：${message}`;
  }

  function createSampleRecords() {
    const records = [];
    const months = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    months.forEach((month, index) => {
      records.push(sampleTx(`salary-${month}`, 'bank', `${month}-05`, 10200 + index * 120, 'income', '示例公司', '代发工资', '银行卡'));
      records.push(sampleTx(`rent-${month}`, 'alipay', `${month}-06`, 2300, 'expense', '安心公寓', '房租', '支付宝'));
      records.push(sampleTx(`food-${month}-1`, 'wechat', `${month}-08`, 168 + index * 8, 'expense', '城市食堂', '本月餐饮', '微信支付'));
      records.push(sampleTx(`food-${month}-2`, 'wechat', `${month}-18`, 128 + index * 5, 'expense', '城市食堂', '晚餐', '微信支付'));
      records.push(sampleTx(`transit-${month}`, 'alipay', `${month}-12`, 220 + index * 12, 'expense', '城市交通', '地铁与打车', '支付宝'));
      records.push(sampleTx(`video-${month}`, 'wechat', `${month}-15`, 25, 'expense', '视频会员', '自动续费', '微信支付'));
      records.push(sampleTx(`grocery-${month}`, 'wechat', `${month}-21`, 360 + index * 18, 'expense', '社区超市', '日用与生鲜', '微信支付'));
    });
    records.push(sampleTx('shopping-1', 'alipay', '2026-04-22', 899, 'expense', '线上商城', '数码配件', '支付宝'));
    records.push(sampleTx('health-1', 'wechat', '2026-05-19', 486, 'expense', '社区药房', '医药用品', '微信支付'));
    records.push(sampleTx('refund-1', 'alipay', '2026-05-23', 199, 'income', '线上商城', '商品退款', '支付宝'));
    records.push(sampleTx('asset-1', 'alipay', '2026-06-10', 1500, 'neutral', '理财平台', '基金申购', '支付宝'));
    records.push(sampleTx('debt-1', 'alipay', '2026-06-11', 1200, 'neutral', '账单还款', '花呗还款', '支付宝'));
    records.push(sampleTx('transfer-1', 'wechat', '2026-06-20', 800, 'neutral', '零钱', '银行卡转入零钱', '微信支付'));
    records.push(sampleTx('wx-cross-source', 'wechat', '2026-06-26', 58, 'expense', '城市咖啡', '咖啡', '微信支付', '09:30:03'));
    records.push(sampleTx('bank-cross-source', 'bank', '2026-06-26', 58, 'expense', '财付通', '财付通 微信支付', '财付通', '09:30:01'));
    return records;
  }

  function sampleTx(id, source, date, amount, direction, merchant, description, channel, time = '12:00:00') {
    return {
      id, source, date, time, datetime: `${date} ${time}`, amount, direction, merchant, description,
      searchText: `${merchant} ${description} ${channel}`, channel,
      paymentMethod: source === 'bank' ? '银行卡' : source === 'wechat' ? '零钱' : '余额', status: '成功',
    };
  }

  function showReport(analysis) {
    STATE.analysis = analysis;
    elements.report.hidden = false;
    renderReportHeader(analysis);
    renderQuality(analysis);
    renderMetrics(analysis);
    renderCategoryChart(analysis);
    renderNeedStructure(analysis);
    renderTrendChart(analysis);
    renderSeparateFlows(analysis);
    renderInsights(analysis);
    renderSources(analysis);
    renderCompactLists(analysis);
    populateCategoryFilter(analysis);
    renderTransactions();
    document.getElementById('report-title').focus({ preventScroll: true });
    elements.report.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderReportHeader(analysis) {
    const prefix = analysis.meta.isSample ? '脱敏示例 · ' : '';
    document.getElementById('report-range').textContent = `${prefix}${analysis.meta.dateRange} · 覆盖 ${analysis.meta.coverageDays} 天`;
  }

  function renderQuality(analysis) {
    const quality = analysis.quality;
    const items = [
      [`${quality.rawRecords}`, '原始交易行'],
      [`${quality.validRecords}`, '报告有效记录'],
      [`${quality.matchedPairs}`, '跨来源去重'],
      [`${quality.ignoredRecords || 0}`, '关闭/退回等忽略'],
      [`${quality.unclassifiedRate}%`, '消费待确认率'],
    ];
    const container = document.getElementById('quality-strip');
    container.replaceChildren(...items.map(([value, label]) => {
      const item = document.createElement('div');
      item.className = 'quality-item';
      const strong = document.createElement('strong');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      item.append(strong, span);
      return item;
    }));
  }

  function renderMetrics(analysis) {
    const summary = analysis.summary;
    setText('metric-expense', formatMoney(summary.netExpense));
    setText('metric-income', formatMoney(summary.totalIncome));
    setText('metric-balance', formatSignedMoney(summary.cashBalance));
    setText('metric-rate', summary.savingsRate == null ? '暂无口径' : `${summary.savingsRate}%`);
    setText('metric-expense-note', `总消费 ${formatMoney(summary.grossExpense)} · 退款 ${formatMoney(summary.refunds)}`);
    setText('metric-income-note', `${summary.incomeCount} 笔真实收入`);
    setText('metric-rate-note', summary.savingsRate == null ? '本期未识别到真实收入' : `日均净消费 ${formatMoney(summary.dailyAverage)}`);
  }

  function renderCategoryChart(analysis) {
    const categories = analysis.categories.slice(0, 9);
    setText('category-total', `${analysis.summary.expenseCount} 笔 · ${formatMoney(analysis.summary.grossExpense)}`);
    const chartElement = document.getElementById('category-chart');
    const summary = document.getElementById('chart-summary');
    summary.replaceChildren(...categories.map((category) => {
      const row = document.createElement('div');
      row.className = 'chart-summary-row';
      const name = document.createElement('span');
      name.textContent = category.name;
      const amount = document.createElement('strong');
      amount.textContent = formatMoney(category.amount);
      const share = document.createElement('span');
      share.textContent = `${category.share}% · ${category.count}笔`;
      row.append(name, amount, share);
      return row;
    }));
    if (!window.echarts || !categories.length) {
      chartElement.hidden = true;
      return;
    }
    chartElement.hidden = false;
    const chart = createChart(chartElement);
    chart.setOption({
      animationDuration: 520,
      aria: { enabled: true, decal: { show: true }, description: '各消费分类按金额从高到低排列。' },
      grid: { left: 10, right: 58, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category', inverse: true, data: categories.map((item) => item.name),
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#35423a', fontSize: 12, margin: 14 },
      },
      series: [{
        type: 'bar', data: categories.map((item, index) => ({
          value: item.amount,
          itemStyle: { color: index === 0 ? '#0c674b' : index < 4 ? '#4d8873' : '#91aa9d', borderRadius: [0, 6, 6, 0] },
        })), barMaxWidth: 22,
        label: { show: true, position: 'right', color: '#667169', fontFamily: 'monospace', formatter: (params) => compactMoney(params.value) },
      }],
      tooltip: { trigger: 'axis', valueFormatter: (value) => formatMoney(value) },
    });
  }

  function renderNeedStructure(analysis) {
    const labels = { essential: '必要消费', discretionary: '可选消费', unclassified: '待确认' };
    const container = document.getElementById('need-structure');
    container.replaceChildren(...analysis.needStructure.map((item) => {
      const row = document.createElement('div');
      row.className = 'need-row';
      row.dataset.type = item.type;
      const head = document.createElement('div');
      head.className = 'need-row-head';
      const label = document.createElement('span');
      label.textContent = labels[item.type] || item.type;
      const amount = document.createElement('span');
      amount.textContent = `${formatMoney(item.amount)} · ${item.share}%`;
      head.append(label, amount);
      const track = document.createElement('div');
      track.className = 'need-track';
      const fill = document.createElement('div');
      fill.className = 'need-fill';
      fill.style.width = `${Math.max(0, Math.min(100, item.share))}%`;
      track.append(fill);
      const note = document.createElement('small');
      note.textContent = item.type === 'essential' ? '基础生活、居住、交通、健康等' : item.type === 'discretionary' ? '购物、娱乐与可调整服务等' : '需要人工核对后再判断';
      row.append(head, track, note);
      return row;
    }));
  }

  function renderTrendChart(analysis) {
    const chartElement = document.getElementById('trend-chart');
    const months = analysis.monthly.filter((item) => item.month !== '日期待确认');
    setText('trend-summary', months.map((item) => `${item.month} 收入${formatMoney(item.income)}，净消费${formatMoney(item.netExpense)}，结余${formatMoney(item.balance)}`).join('；'));
    if (!window.echarts || !months.length) {
      chartElement.hidden = true;
      return;
    }
    chartElement.hidden = false;
    const chart = createChart(chartElement);
    chart.setOption({
      animationDuration: 520,
      aria: { enabled: true, decal: { show: true }, description: '按月比较真实收入、净消费和现金结余。' },
      color: ['#0c674b', '#ad6426', '#315e77'],
      legend: { data: ['真实收入', '净消费', '现金结余'], top: 0, textStyle: { color: '#667169' } },
      grid: { left: 16, right: 18, top: 48, bottom: 18, containLabel: true },
      xAxis: { type: 'category', data: months.map((item) => item.month), axisLine: { lineStyle: { color: '#d7d1c5' } }, axisTick: { show: false }, axisLabel: { color: '#667169' } },
      yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#e4dfd4' } }, axisLabel: { color: '#667169', formatter: compactMoney } },
      tooltip: { trigger: 'axis', valueFormatter: (value) => formatMoney(value) },
      series: [
        { name: '真实收入', type: 'bar', data: months.map((item) => item.income), barMaxWidth: 24, itemStyle: { borderRadius: [5, 5, 0, 0] } },
        { name: '净消费', type: 'bar', data: months.map((item) => item.netExpense), barMaxWidth: 24, itemStyle: { borderRadius: [5, 5, 0, 0] } },
        { name: '现金结余', type: 'line', data: months.map((item) => item.balance), smooth: 0.25, symbolSize: 7, lineStyle: { width: 2.5 } },
      ],
    });
  }

  function renderSeparateFlows(analysis) {
    const items = [
      ['内部流转', analysis.summary.transferFlow, '本人账户、余额工具之间移动'],
      ['资产变动', analysis.summary.assetFlow, '申购、赎回等资产形态变化'],
      ['债务偿还', analysis.summary.debtFlow, '避免与已记录消费重复计算'],
    ];
    const container = document.getElementById('separate-flows');
    container.replaceChildren(...items.map(([label, value, note]) => {
      const row = document.createElement('div');
      row.className = 'separate-flow';
      const span = document.createElement('span'); span.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = formatMoney(value);
      const small = document.createElement('small'); small.textContent = note;
      row.append(span, strong, small);
      return row;
    }));
  }

  function renderInsights(analysis) {
    const container = document.getElementById('insight-list');
    container.replaceChildren(...analysis.recommendations.map((insight, index) => {
      const card = document.createElement('article');
      card.className = 'insight-card';
      card.dataset.tone = insight.tone;
      const kicker = document.createElement('div');
      kicker.className = 'insight-kicker';
      kicker.textContent = `发现 ${String(index + 1).padStart(2, '0')}`;
      const title = document.createElement('h3'); title.textContent = insight.title;
      const evidence = document.createElement('p'); evidence.className = 'insight-evidence'; evidence.textContent = insight.evidence;
      const impact = document.createElement('p'); impact.className = 'insight-impact'; impact.textContent = insight.impact;
      const action = document.createElement('p'); action.className = 'insight-action';
      const actionLabel = document.createElement('strong'); actionLabel.textContent = '可选行动';
      action.append(actionLabel, document.createTextNode(insight.action));
      card.append(kicker, title, evidence, impact, action);
      return card;
    }));
  }

  function renderSources(analysis) {
    const container = document.getElementById('source-list');
    const sourceTotals = new Map();
    analysis.transactions.forEach((item) => {
      if (!sourceTotals.has(item.source)) sourceTotals.set(item.source, { count: 0, netExpense: 0 });
      const value = sourceTotals.get(item.source);
      value.count += 1;
      if (item.flowType === 'expense') value.netExpense += item.amount;
      if (item.flowType === 'refund') value.netExpense -= item.amount;
    });
    const rows = Object.keys(SOURCE_META).filter((source) => sourceTotals.has(source)).map((source) => {
      const row = document.createElement('div');
      row.className = 'source-row';
      const name = createSourceName(source);
      const count = document.createElement('small');
      count.textContent = `${sourceTotals.get(source).count} 条有效记录`;
      name.append(count);
      const amount = document.createElement('strong');
      amount.textContent = formatMoney(sourceTotals.get(source).netExpense);
      row.append(name, amount);
      return row;
    });
    container.replaceChildren(...(rows.length ? rows : [emptyState('没有来源数据')]));
  }

  function renderCompactLists(analysis) {
    const anomalies = document.getElementById('anomaly-list');
    setText('anomaly-count', `${analysis.anomalies.length} 笔`);
    anomalies.replaceChildren(...(analysis.anomalies.length ? analysis.anomalies.map((item) => compactTransactionRow(item)) : [emptyState('没有识别到明显异常交易')]));
    const recurring = document.getElementById('recurring-list');
    recurring.replaceChildren(...(analysis.recurringCandidates.length ? analysis.recurringCandidates.map((item) => {
      const row = document.createElement('div');
      row.className = 'compact-row';
      const copy = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = item.name;
      const small = document.createElement('small'); small.textContent = `${item.months} 个月 · ${item.count} 次`;
      copy.append(strong, small);
      const amount = document.createElement('span'); amount.textContent = formatMoney(item.amount);
      row.append(copy, amount);
      return row;
    }) : [emptyState('至少覆盖三个月后，才能识别周期性候选')]));
  }

  function compactTransactionRow(item) {
    const row = document.createElement('div');
    row.className = 'compact-row';
    const copy = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = item.merchant || '商户待确认';
    const small = document.createElement('small'); small.textContent = `${item.date} · ${item.categoryName}`;
    copy.append(strong, small);
    const amount = document.createElement('span'); amount.textContent = formatMoney(item.amount);
    row.append(copy, amount);
    return row;
  }

  function populateCategoryFilter(analysis) {
    const current = elements.categoryFilter.value;
    const options = [new Option('全部', '')];
    analysis.categories.forEach((category) => options.push(new Option(category.name, category.id)));
    elements.categoryFilter.replaceChildren(...options);
    if (Array.from(elements.categoryFilter.options).some((option) => option.value === current)) elements.categoryFilter.value = current;
  }

  function renderTransactions() {
    if (!STATE.analysis) return;
    const query = elements.search.value.trim().toLowerCase();
    const filtered = STATE.analysis.transactions.filter((item) => {
      if (elements.flowFilter.value && item.flowType !== elements.flowFilter.value) return false;
      if (elements.sourceFilter.value && item.source !== elements.sourceFilter.value) return false;
      if (elements.categoryFilter.value && item.categoryId !== elements.categoryFilter.value) return false;
      if (query && !`${item.merchant} ${item.description} ${item.categoryName}`.toLowerCase().includes(query)) return false;
      return true;
    });
    setText('transaction-count', `显示 ${Math.min(filtered.length, 500)} / ${filtered.length} 笔`);
    document.getElementById('transaction-body').replaceChildren(...filtered.slice(0, 500).map(createTableRow));
    document.getElementById('mobile-transactions').replaceChildren(...filtered.slice(0, 200).map(createMobileTransaction));
  }

  function createTableRow(item) {
    const row = document.createElement('tr');
    row.append(
      cell(item.date),
      cellWith(flowPill(item)),
      cellWith(transactionCopy(item)),
      cellWith(categoryPill(item.categoryName)),
      cellWith(createSourceMini(item.source)),
      amountCell(item),
    );
    return row;
  }

  function createMobileTransaction(item) {
    const card = document.createElement('article');
    card.className = 'mobile-transaction';
    const top = document.createElement('div'); top.className = 'mobile-transaction-top';
    const date = document.createElement('span'); date.textContent = item.date;
    top.append(date, amountLabel(item));
    const title = document.createElement('h3'); title.textContent = item.merchant || '商户待确认';
    const description = document.createElement('p'); description.textContent = item.description || '暂无说明';
    const bottom = document.createElement('div'); bottom.className = 'mobile-transaction-bottom';
    bottom.append(flowPill(item), categoryPill(item.categoryName), createSourceMini(item.source));
    card.append(top, title, description, bottom);
    return card;
  }

  function transactionCopy(item) {
    const wrapper = document.createElement('div'); wrapper.className = 'transaction-main';
    const strong = document.createElement('strong'); strong.textContent = item.merchant || '商户待确认';
    const small = document.createElement('small'); small.textContent = item.description || '暂无说明';
    wrapper.append(strong, small);
    return wrapper;
  }

  function flowPill(item) {
    const pill = document.createElement('span');
    pill.className = 'flow-pill'; pill.dataset.flow = item.flowType;
    pill.textContent = FLOW_META[item.flowType] ? FLOW_META[item.flowType].label : item.flowType;
    return pill;
  }

  function categoryPill(label) {
    const pill = document.createElement('span'); pill.className = 'category-pill'; pill.textContent = label || '待确认'; return pill;
  }

  function createSourceName(source) {
    const wrapper = document.createElement('div'); wrapper.className = 'source-name';
    const meta = SOURCE_META[source] || { label: source, icon: null };
    if (meta.icon) {
      const image = document.createElement('img'); image.src = meta.icon; image.alt = '';
      wrapper.append(image);
    } else {
      const mark = document.createElement('span'); mark.className = 'source-bank-mark'; mark.textContent = 'BANK'; wrapper.append(mark);
    }
    const copy = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = meta.label;
    copy.append(strong); wrapper.append(copy); return wrapper;
  }

  function createSourceMini(source) {
    const wrapper = document.createElement('span'); wrapper.className = 'source-mini';
    const meta = SOURCE_META[source] || { label: source, icon: null };
    if (meta.icon) { const image = document.createElement('img'); image.src = meta.icon; image.alt = ''; wrapper.append(image); }
    const label = document.createElement('span'); label.textContent = meta.label; wrapper.append(label); return wrapper;
  }

  function cell(value) { const td = document.createElement('td'); td.textContent = value; return td; }
  function cellWith(node) { const td = document.createElement('td'); td.append(node); return td; }
  function amountCell(item) { const td = document.createElement('td'); td.className = 'align-right'; td.append(amountLabel(item)); return td; }
  function amountLabel(item) {
    const span = document.createElement('span');
    span.className = `transaction-amount is-${item.flowType}`;
    const meta = FLOW_META[item.flowType] || { sign: '' };
    span.textContent = `${meta.sign}${formatMoney(item.amount)}`;
    return span;
  }

  function emptyState(message) { const div = document.createElement('div'); div.className = 'empty-state'; div.textContent = message; return div; }
  function setText(id, value) { document.getElementById(id).textContent = value; }
  function formatMoney(value) { return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
  function formatSignedMoney(value) { const number = Number(value || 0); return `${number > 0 ? '+' : number < 0 ? '−' : ''}${formatMoney(Math.abs(number))}`; }
  function compactMoney(value) { const number = Number(value || 0); return Math.abs(number) >= 10000 ? `${(number / 10000).toFixed(1)}万` : Math.round(number).toLocaleString('zh-CN'); }

  function createChart(element) {
    const existing = window.echarts.getInstanceByDom(element);
    if (existing) existing.dispose();
    const chart = window.echarts.init(element, null, { renderer: 'canvas' });
    STATE.charts.push(chart);
    return chart;
  }

  function resetApplication() {
    STATE.analysis = null;
    STATE.charts.forEach((chart) => chart.dispose());
    STATE.charts = [];
    elements.report.hidden = true;
    Object.keys(STATE.files).forEach(clearFile);
    elements.search.value = '';
    elements.flowFilter.value = '';
    elements.sourceFilter.value = '';
    elements.categoryFilter.replaceChildren(new Option('全部', ''));
    setProgress('');
    document.getElementById('upload-title').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
})();
