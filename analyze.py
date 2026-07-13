#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人账单分析工具 v1.1
======================
数据源：银行卡流水 CSV / PDF（所有消费最终从卡里扣，唯一真相，不重复计数）
输出：  可视化 HTML 报告（分类占比饼图 + 月度趋势 + 消费明细表）

用法：
  python analyze.py <CSV或PDF文件路径>
  python analyze.py <文件路径> --output report.html --title "我的账单"
  python analyze.py <文件路径> --categories my_categories.json

支持的文件格式：
  CSV：自动检测编码(UTF-8/GBK)、分隔符(逗号/制表符/分号)
  PDF：银行流水 PDF（需要 pdfplumber 库，首次使用自动提示安装）
"""

import csv
import json
import sys
import os
import re
from datetime import datetime
from collections import defaultdict
from pathlib import Path

# ============================================================
# 1. 默认分类关键词库（可通过 categories.json 覆盖/扩展）
# ============================================================

DEFAULT_CATEGORIES = {
    "餐饮美食": [
        "美团", "饿了么", "大众点评", "肯德基", "麦当劳", "汉堡王", "华莱士",
        "星巴克", "瑞幸", "蜜雪冰城", "喜茶", "奈雪", "茶百道", "古茗", "库迪",
        "海底捞", "火锅", "烧烤", "餐厅", "饭店", "小吃", "外卖", "午餐", "晚餐",
        "早餐", "美食", "餐饮", "奶茶", "咖啡", "面馆", "快餐", "饺子", "麻辣烫",
        "便利店", "罗森", "全家", "7-11", "美宜佳", "良品铺子", "三只松鼠"
    ],
    "交通出行": [
        "滴滴", "快的", "高德", "12306", "铁路", "高铁", "火车", "机票", "航空",
        "地铁", "公交", "出租车", "打车", "出行", "加油", "中石化", "中石油",
        "壳牌", "停车", "过路费", "ETC", "共享单车", "哈啰", "美团单车", "青桔"
    ],
    "购物消费": [
        "淘宝", "天猫", "京东", "拼多多", "唯品会", "苏宁", "得物", "当当",
        "亚马逊", "闲鱼", "转转", "超市", "沃尔玛", "大润发", "永辉", "盒马",
        "屈臣氏", "名创优品", "优衣库", "ZARA", "服装", "鞋", "数码", "电子",
        "家电", "日用", "百货", "化妆品", "护肤"
    ],
    "生活缴费": [
        "电费", "水费", "燃气", "物业", "宽带", "网费", "话费", "中国移动",
        "中国联通", "中国电信", "有线电视", "暖气", "供暖", "房租", "租金",
        "话费充值", "手机充值", "流量充值", "电费充值", "水费充值", "燃气充值",
        "缴费"
    ],
    "娱乐休闲": [
        "电影", "猫眼", "淘票票", "KTV", "网吧", "网咖", "游戏", "Steam",
        "腾讯视频", "爱奇艺", "优酷", "哔哩哔哩", "B站", "网易云", "QQ音乐",
        "健身", "瑜伽", "游泳", "台球", "密室", "剧本杀", "美团门票"
    ],
    "医疗健康": [
        "药店", "医院", "诊所", "体检", "牙科", "眼科", "医药", "保健",
        "保险", "社保", "挂号"
    ],
    "教育学习": [
        "书店", "培训", "课程", "网课", "得到", "知乎", "极客时间", "图书",
        "学习", "考试", "报名", "教育"
    ]
}

# 收入关键词
INCOME_KEYWORDS = ["工资", "薪资", "代发", "奖金", "收入", "转入", "存入", "收款", "利息", "退税"]

# 内部转账/人情/理财关键词（不计入日常消费分析）
TRANSFER_KEYWORDS = [
    "转账", "转出", "转入", "提现", "零钱通", "余额宝", "理财", "基金申购", "基金赎回",
    "充值至他人", "扫二维码付款", "他人支付账户"
]

# 列名别名映射（用于自动识别不同银行的 CSV 列名）
COLUMN_ALIASES = {
    "date": ["交易日期", "记账日期", "日期", "交易时间", "入账日期", "date", "时间"],
    "amount": ["交易金额", "金额", "发生额", "交易额", "amount", "钞汇金额"],
    "direction": ["收/支", "收支状态", "收支", "交易类型", "借贷方向", "方向", "摘要标志", "钞汇标志"],
    "counterparty": ["对方户名", "对方账户", "对方名称", "交易对手", "对方账号", "付款方"],
    "counterparty_bank": ["对方行名", "对方开户行"],
    "summary": ["摘要", "备注", "用途", "说明", "交易摘要", "detail", "description"],
    "remark": ["附言", "备注2", "交易描述"],
    "channel_method": ["交易渠道", "支付渠道", "交易通道"],
    "balance": ["余额", "账户余额", "balance"],
}

# ============================================================
# 2. 数据模型
# ============================================================

class Transaction:
    """单条交易记录"""
    def __init__(self, date_str, amount, direction, counterparty, summary, remark="",
                 counterparty_bank="", channel_method=""):
        self.date_str = date_str
        self.amount = abs(float(amount)) if amount else 0.0
        self.direction = direction  # 'income' / 'expense' / 'transfer'
        self.counterparty = counterparty or ""
        self.counterparty_bank = counterparty_bank or ""
        self.summary = summary or ""
        self.remark = remark or ""
        self.channel_method = channel_method or ""
        self.category = "未分类"
        self.channel = self._detect_channel()
        self.month = self._extract_month()

    def _detect_channel(self):
        text = f"{self.counterparty_bank} {self.counterparty} {self.summary} {self.remark} {self.channel_method}"
        if "财付通" in text or "微信" in text:
            return "微信支付"
        elif "支付宝" in text:
            return "支付宝"
        elif "银联" in text:
            return "银联"
        else:
            return "银行卡"

    def _extract_month(self):
        """从日期字符串中提取 YYYY-MM"""
        # 尝试多种日期格式
        for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%Y%m%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"]:
            try:
                dt = datetime.strptime(self.date_str.strip()[:19], fmt)
                return dt.strftime("%Y-%m")
            except (ValueError, TypeError):
                continue
        # 尝试提取 YYYY-MM 模式
        match = re.search(r'(\d{4})[-/](\d{1,2})', self.date_str)
        if match:
            return f"{match.group(1)}-{int(match.group(2)):02d}"
        return "未知"

    @property
    def full_text(self):
        return f"{self.counterparty_bank} {self.counterparty} {self.summary} {self.remark} {self.channel_method}"

    def to_dict(self):
        return {
            "date": self.date_str,
            "month": self.month,
            "amount": round(self.amount, 2),
            "direction": self.direction,
            "counterparty": self.counterparty,
            "counterparty_bank": self.counterparty_bank,
            "summary": self.summary,
            "remark": self.remark,
            "channel_method": self.channel_method,
            "category": self.category,
            "channel": self.channel,
        }


# ============================================================
# 3. CSV 解析器（自动检测编码、分隔符、列名）
# ============================================================

def detect_encoding(filepath):
    """尝试检测文件编码"""
    for enc in ["utf-8-sig", "utf-8", "gbk", "gb18030", "big5"]:
        try:
            with open(filepath, "r", encoding=enc) as f:
                f.read(2048)
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return "utf-8"


def detect_delimiter(filepath, encoding):
    """自动检测分隔符"""
    with open(filepath, "r", encoding=encoding) as f:
        first_line = f.readline()
    for delim in ["\t", ",", ";", "|"]:
        if delim in first_line:
            return delim
    return ","


def map_columns(header):
    """将 CSV 列名映射到标准字段"""
    mapping = {}
    for standard_name, aliases in COLUMN_ALIASES.items():
        for col_idx, col_name in enumerate(header):
            col_clean = col_name.strip().replace(" ", "").replace("\ufeff", "")
            for alias in aliases:
                if alias in col_clean:
                    if standard_name not in mapping:
                        mapping[standard_name] = col_idx
                        break
    return mapping


def parse_csv(filepath):
    """解析银行流水 CSV 文件"""
    encoding = detect_encoding(filepath)
    delimiter = detect_delimiter(filepath, encoding)

    transactions = []
    with open(filepath, "r", encoding=encoding) as f:
        reader = csv.reader(f, delimiter=delimiter)
        rows = list(reader)

    if not rows:
        return [], "未检测到数据"

    # 跳过可能的标题行/说明行（找到第一个包含"日期"或"金额"的行作为表头）
    header_row_idx = 0
    for i, row in enumerate(rows[:5]):
        row_text = ",".join(row)
        if "日期" in row_text or "金额" in row_text or "date" in row_text.lower():
            header_row_idx = i
            break

    header = rows[header_row_idx]
    col_map = map_columns(header)

    if "date" not in col_map or "amount" not in col_map:
        return [], (
            f"无法自动识别列名。\n"
            f"检测到的表头: {header}\n"
            f"请确保 CSV 包含日期和金额列。\n"
            f"支持的列名: {json.dumps(COLUMN_ALIASES, ensure_ascii=False)}"
        )

    # 解析数据行
    for row in rows[header_row_idx + 1:]:
        if not row or len(row) < 2:
            continue

        def get_col(name):
            idx = col_map.get(name)
            if idx is not None and idx < len(row):
                return row[idx].strip()
            return ""

        date_str = get_col("date")
        amount_str = get_col("amount")
        counterparty = get_col("counterparty")
        counterparty_bank = get_col("counterparty_bank")
        summary = get_col("summary")
        remark = get_col("remark")
        channel_method = get_col("channel_method")

        # 跳过空行/汇总行
        if not date_str or not amount_str:
            continue

        # 清理金额字符串
        amount_str = amount_str.replace(",", "").replace("，", "").replace("¥", "").replace("￥", "").strip()
        try:
            amount = float(amount_str)
        except ValueError:
            continue

        # 判断收/支方向
        direction_str = get_col("direction")
        direction = detect_direction(direction_str, amount, counterparty, summary)

        # 如果金额为负且没有方向信息，视为支出
        if amount < 0 and direction == "expense":
            amount = abs(amount)

        tx = Transaction(date_str, abs(amount), direction, counterparty, summary, remark,
                         counterparty_bank, channel_method)
        transactions.append(tx)

    info = f"编码: {encoding} | 分隔符: {'制表符' if delimiter == chr(9) else delimiter} | 列映射: {col_map}"
    return transactions, info


def parse_pdf(filepath):
    """解析银行流水 PDF 文件（使用 pdfplumber 提取表格，失败则按文本行解析）"""
    try:
        import pdfplumber
    except ImportError:
        print("  [提示] PDF 解析需要 pdfplumber 库，请先安装:")
        print("        pip install pdfplumber")
        print()
        print("  或者将 PDF 导出为 CSV 格式后使用 CSV 模式")
        sys.exit(1)

    all_rows = []
    page_count = 0

    with pdfplumber.open(filepath) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            # 方法1：表格提取（适合标准银行 PDF）
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for row in table:
                        cleaned_row = [str(c).strip() if c is not None else "" for c in row]
                        all_rows.append(cleaned_row)
            else:
                # 方法2：文本行提取（兜底策略，适合表格结构不清晰的 PDF）
                text = page.extract_text()
                if text:
                    for line in text.split("\n"):
                        line = line.strip()
                        if not line:
                            continue
                        # 检查是否包含数字（金额）和日期特征，可能是交易数据行
                        if re.search(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{8}', line) and re.search(r'\d+\.?\d*', line):
                            # 用空格/制表符分割字段
                            fields = re.split(r'\s{2,}|\t', line)
                            fields = [f.strip() for f in fields if f.strip()]
                            if len(fields) >= 3:
                                all_rows.append(fields)

    if not all_rows:
        return [], (
            "PDF 中未找到可解析的交易数据。\n"
            "建议：1) 尝试从银行 App 导出 CSV 格式\n"
            "       2) 如果是扫描件/图片 PDF，可能需要先 OCR 处理"
        )

    # 找到表头行
    header_row_idx = 0
    for i, row in enumerate(all_rows[:10]):
        row_text = " ".join(row)
        if "日期" in row_text or "金额" in row_text:
            header_row_idx = i
            break

    header = all_rows[header_row_idx]
    col_map = map_columns(header)

    if "date" not in col_map or "amount" not in col_map:
        # 打印诊断信息帮助用户排查
        print(f"  [诊断] 检测到的表头: {header}")
        print(f"  [诊断] 列映射结果: {col_map}")
        print(f"  [诊断] 前5行数据:")
        for i, row in enumerate(all_rows[header_row_idx+1:header_row_idx+6]):
            print(f"          {row}")
        return [], (
            f"无法自动识别列名。\n"
            f"请确保 PDF 包含日期和金额列，或将 PDF 导出为 CSV 格式。"
        )

    # 解析数据行（跳过表头和可能的重复表头）
    seen_header_texts = set()
    header_text = " ".join(header)
    seen_header_texts.add(header_text)

    transactions = []
    skipped = 0
    for row in all_rows[header_row_idx + 1:]:
        row_text = " ".join(row)
        if row_text in seen_header_texts:
            continue
        if not row or len(row) < 2:
            continue
        # 跳过汇总行
        if any(kw in row_text for kw in ["合计", "总计", "小计", "汇总", "承前页", "转次页"]):
            continue
        # 跳过全空行（所有字段都是空字符串）
        if all(not f for f in row):
            skipped += 1
            continue

        def get_col(name):
            idx = col_map.get(name)
            if idx is not None and idx < len(row):
                return row[idx]
            return ""

        date_str = get_col("date")
        amount_str = get_col("amount")
        counterparty = get_col("counterparty")
        counterparty_bank = get_col("counterparty_bank")
        summary = get_col("summary")
        remark = get_col("remark")
        channel_method = get_col("channel_method")

        # 跳过空行/无效数据
        if not date_str or not amount_str:
            continue

        # 清理金额字符串（PDF 可能带 ¥ 符号或千位逗号）
        amount_str = amount_str.replace(",", "").replace("，", "").replace("¥", "").replace("￥", "").replace(" ", "").strip()
        try:
            amount = float(amount_str)
        except ValueError:
            continue

        # 判断收/支方向
        direction_str = get_col("direction")
        direction = detect_direction(direction_str, amount, counterparty, summary)

        if amount < 0 and direction == "expense":
            amount = abs(amount)

        tx = Transaction(date_str, abs(amount), direction, counterparty, summary, remark,
                         counterparty_bank, channel_method)
        transactions.append(tx)

    info = f"文件类型: PDF | 页数: {page_count} | 数据行: {len(all_rows)-header_row_idx-1} | 跳过空行: {skipped} | 列映射: {col_map}"
    return transactions, info


def detect_direction(direction_str, amount, counterparty, summary):
    """判断交易方向：收入/支出/转账"""
    text = f"{direction_str} {counterparty} {summary}"

    # 优先看方向列
    if direction_str:
        d = direction_str.strip()
        if d in ["收入", "贷", "入", "存入", "转入"]:
            return "income"
        elif d in ["支出", "借", "出", "支出", "消费", "转出"]:
            return "expense"

    # 看关键词
    for kw in INCOME_KEYWORDS:
        if kw in text:
            return "income"

    # 检查是否是内部转账
    for kw in TRANSFER_KEYWORDS:
        if kw in text:
            return "transfer"

    # 看金额正负
    if amount < 0:
        return "expense"
    elif amount > 0:
        # 如果是来自已知收入来源
        if any(kw in text for kw in INCOME_KEYWORDS):
            return "income"
        # 默认小额为支出，大额可能是转账
        return "expense"

    return "expense"


# ============================================================
# 4. 分类引擎
# ============================================================

def load_categories(filepath=None):
    """加载分类配置，优先使用外部文件，否则用默认"""
    if filepath and os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)

    # 检查同目录下的 categories.json
    local_config = Path(filepath or "categories.json")
    if not filepath and local_config.exists():
        with open(str(local_config), "r", encoding="utf-8") as f:
            external = json.load(f)
            # 合并：外部配置覆盖同名分类，新增外部分类
            merged = {**DEFAULT_CATEGORIES, **external}
            return merged

    # 也检查脚本同目录
    script_dir = Path(__file__).parent
    auto_config = script_dir / "categories.json"
    if auto_config.exists():
        with open(str(auto_config), "r", encoding="utf-8") as f:
            external = json.load(f)
            merged = {**DEFAULT_CATEGORIES, **external}
            return merged

    return DEFAULT_CATEGORIES


def categorize_transaction(tx, categories):
    """对单条交易进行分类"""
    text = tx.full_text

    # 先检查是否是退款
    if "退款" in text or "退货" in text:
        tx.category = "退款"
        return

    # 再检查是否是转账/人情/理财类（优先于消费分类，避免"充值"等词被误分类）
    for kw in TRANSFER_KEYWORDS:
        if kw in text:
            tx.category = "转账/人情/理财"
            return

    # 按分类优先级匹配
    for category, keywords in categories.items():
        for keyword in keywords:
            if keyword in text:
                tx.category = category
                return

    # 未匹配到，根据支付渠道标记
    if tx.channel == "微信支付":
        tx.category = "微信支付(未分类)"
    elif tx.channel == "支付宝":
        tx.category = "支付宝(未分类)"
    else:
        tx.category = "其他"


# ============================================================
# 5. HTML 报告生成器
# ============================================================

def generate_report(transactions, output_path, title="个人账单分析报告"):
    """生成可视化 HTML 报告"""

    # 分离收入、支出、转账
    incomes = [t for t in transactions if t.direction == "income"]
    expenses = [t for t in transactions if t.direction == "expense"]
    transfers = [t for t in transactions if t.direction == "transfer"]

    # 统计
    total_income = sum(t.amount for t in incomes)
    total_expense = sum(t.amount for t in expenses)
    balance = total_income - total_expense
    savings_rate = (balance / total_income * 100) if total_income > 0 else 0

    # 日期范围
    dates = sorted([t.month for t in transactions if t.month != "未知"])
    date_range = f"{dates[0]} ~ {dates[-1]}" if dates else "未知"

    # 分类统计
    category_stats = defaultdict(lambda: {"count": 0, "amount": 0.0})
    for t in expenses:
        category_stats[t.category]["count"] += 1
        category_stats[t.category]["amount"] += t.amount
    category_data = sorted(
        [{"name": k, "value": round(v["amount"], 2), "count": v["count"]}
         for k, v in category_stats.items()],
        key=lambda x: x["value"],
        reverse=True
    )

    # 月度统计
    monthly_stats = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for t in transactions:
        if t.direction == "income":
            monthly_stats[t.month]["income"] += t.amount
        elif t.direction == "expense":
            monthly_stats[t.month]["expense"] += t.amount
    monthly_data = sorted(
        [{"month": k, "income": round(v["income"], 2), "expense": round(v["expense"], 2)}
         for k, v in monthly_stats.items()],
        key=lambda x: x["month"]
    )

    # 支付渠道统计
    channel_stats = defaultdict(lambda: {"count": 0, "amount": 0.0})
    for t in expenses:
        channel_stats[t.channel]["count"] += 1
        channel_stats[t.channel]["amount"] += t.amount
    channel_data = sorted(
        [{"name": k, "value": round(v["amount"], 2), "count": v["count"]}
         for k, v in channel_stats.items()],
        key=lambda x: x["value"],
        reverse=True
    )

    # Top 10 消费
    top_expenses = sorted(expenses, key=lambda t: t.amount, reverse=True)[:10]
    top_data = [
        {"date": t.date_str, "amount": round(t.amount, 2), "desc": t.summary or t.counterparty,
         "category": t.category, "channel": t.channel}
        for t in top_expenses
    ]

    # 全部交易记录
    all_tx_data = [t.to_dict() for t in sorted(transactions, key=lambda t: t.date_str, reverse=True)]

    # 准备嵌入数据
    report_data = {
        "title": title,
        "dateRange": date_range,
        "summary": {
            "totalIncome": round(total_income, 2),
            "totalExpense": round(total_expense, 2),
            "balance": round(balance, 2),
            "savingsRate": round(savings_rate, 1),
            "incomeCount": len(incomes),
            "expenseCount": len(expenses),
            "transferCount": len(transfers),
        },
        "categoryData": category_data,
        "monthlyData": monthly_data,
        "channelData": channel_data,
        "topExpenses": top_data,
        "transactions": all_tx_data,
    }

    # 生成 HTML
    html = build_html(report_data)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    return report_data


def build_html(data):
    """构建 HTML 报告"""
    json_data = json.dumps(data, ensure_ascii=False)

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="author" content="tphu">
<title>{data["title"]}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
<style>
  :root {{
    --bg: #0d1117;
    --card-bg: #161b22;
    --card-border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --accent-red: #f85149;
    --accent-green: #3fb950;
    --accent-blue: #58a6ff;
    --accent-yellow: #d29922;
    --accent-purple: #bc8cff;
    --accent-cyan: #39c5cf;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }}
  .header {{
    text-align: center;
    margin-bottom: 32px;
    padding: 32px 0;
    border-bottom: 1px solid var(--card-border);
  }}
  .header h1 {{ font-size: 28px; font-weight: 700; margin-bottom: 8px; }}
  .header .date-range {{ color: var(--text-muted); font-size: 15px; }}
  .summary-grid {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 32px;
  }}
  .summary-card {{
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    transition: transform 0.2s;
  }}
  .summary-card:hover {{ transform: translateY(-2px); }}
  .summary-card .label {{ color: var(--text-muted); font-size: 13px; margin-bottom: 8px; }}
  .summary-card .value {{ font-size: 28px; font-weight: 700; }}
  .summary-card .sub {{ color: var(--text-muted); font-size: 12px; margin-top: 4px; }}
  .value.income {{ color: var(--accent-green); }}
  .value.expense {{ color: var(--accent-red); }}
  .value.balance {{ color: var(--accent-blue); }}
  .value.rate {{ color: var(--accent-yellow); }}
  .chart-row {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 32px;
  }}
  .chart-card {{
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 24px;
  }}
  .chart-card h3 {{
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text);
  }}
  .chart-container {{ width: 100%; height: 320px; }}
  .full-width {{ grid-column: 1 / -1; }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }}
  th, td {{
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--card-border);
  }}
  th {{
    color: var(--text-muted);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  tr:hover {{ background: rgba(255,255,255,0.03); }}
  .amount-expense {{ color: var(--accent-red); }}
  .amount-income {{ color: var(--accent-green); }}
  .category-tag {{
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }}
  .filter-bar {{
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    align-items: center;
    flex-wrap: wrap;
  }}
  .filter-bar select, .filter-bar input {{
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
  }}
  .filter-bar input {{ flex: 1; min-width: 200px; }}
  .table-wrap {{
    max-height: 500px;
    overflow-y: auto;
    border-radius: 8px;
  }}
  .table-wrap::-webkit-scrollbar {{ width: 6px; }}
  .table-wrap::-webkit-scrollbar-track {{ background: var(--bg); }}
  .table-wrap::-webkit-scrollbar-thumb {{ background: var(--card-border); border-radius: 3px; }}
  .section-title {{
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 16px;
    padding-left: 12px;
    border-left: 3px solid var(--accent-blue);
  }}
  .footer {{
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--card-border);
  }}
  @media (max-width: 768px) {{
    .summary-grid {{ grid-template-columns: repeat(2, 1fr); }}
    .chart-row {{ grid-template-columns: 1fr; }}
  }}
</style>
</head>
<body>

<div class="header">
  <h1>{data["title"]}</h1>
  <div class="date-range">{data["dateRange"]} | 共 {data["summary"]["incomeCount"] + data["summary"]["expenseCount"]} 笔交易</div>
</div>

<div class="summary-grid">
  <div class="summary-card">
    <div class="label">总收入</div>
    <div class="value income">¥{data["summary"]["totalIncome"]:,.2f}</div>
    <div class="sub">{data["summary"]["incomeCount"]} 笔</div>
  </div>
  <div class="summary-card">
    <div class="label">总支出</div>
    <div class="value expense">¥{data["summary"]["totalExpense"]:,.2f}</div>
    <div class="sub">{data["summary"]["expenseCount"]} 笔</div>
  </div>
  <div class="summary-card">
    <div class="label">结余</div>
    <div class="value balance">¥{data["summary"]["balance"]:,.2f}</div>
    <div class="sub">收入 - 支出</div>
  </div>
  <div class="summary-card">
    <div class="label">结余率</div>
    <div class="value rate">{data["summary"]["savingsRate"]}%</div>
    <div class="sub">结余 / 收入</div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>消费分类占比</h3>
    <div id="pieChart" class="chart-container"></div>
  </div>
  <div class="chart-card">
    <h3>月度收支趋势</h3>
    <div id="barChart" class="chart-container"></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card full-width">
    <h3>支付渠道分布</h3>
    <div id="channelChart" class="chart-container" style="height: 260px;"></div>
  </div>
</div>

<div style="margin-bottom: 32px;">
  <div class="section-title">Top 10 消费明细</div>
  <div class="chart-card">
    <table>
      <thead>
        <tr><th>#</th><th>日期</th><th>金额</th><th>描述</th><th>分类</th><th>渠道</th></tr>
      </thead>
      <tbody id="topTable"></tbody>
    </table>
  </div>
</div>

<div>
  <div class="section-title">全部交易记录</div>
  <div class="chart-card">
    <div class="filter-bar">
      <select id="categoryFilter">
        <option value="">全部分类</option>
      </select>
      <select id="directionFilter">
        <option value="">收支</option>
        <option value="income">收入</option>
        <option value="expense">支出</option>
        <option value="transfer">转账</option>
      </select>
      <input type="text" id="searchInput" placeholder="搜索描述、对方户名...">
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>日期</th><th>方向</th><th>金额</th><th>对方/摘要</th><th>分类</th><th>渠道</th></tr>
        </thead>
        <tbody id="txTable"></tbody>
      </table>
    </div>
  </div>
</div>

<div class="footer">
  钱都去哪了 · by tphu | 数据源：银行卡流水 | 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}
</div>

<script>
const REPORT_DATA = {json_data};

// 颜色方案
const COLORS = ['#f85149','#58a6ff','#3fb950','#d29922','#bc8cff','#39c5cf','#ff7b72','#79c0ff','#56d364','#e3b341'];

// 1. 分类饼图
const pieChart = echarts.init(document.getElementById('pieChart'));
pieChart.setOption({{
  tooltip: {{ trigger: 'item', formatter: '{{b}}<br/>¥{{c}} ({{d}}%)' }},
  legend: {{ bottom: 0, type: 'scroll', textStyle: {{ color: '#8b949e' }} }},
  color: COLORS,
  series: [{{
    type: 'pie',
    radius: ['40%', '70%'],
    center: ['50%', '45%'],
    itemStyle: {{ borderColor: '#161b22', borderWidth: 2 }},
    label: {{ color: '#e6edf3', fontSize: 12 }},
    data: REPORT_DATA.categoryData.map(c => ({{ name: c.name, value: c.value }}))
  }}]
}});

// 2. 月度柱状图
const barChart = echarts.init(document.getElementById('barChart'));
barChart.setOption({{
  tooltip: {{ trigger: 'axis' }},
  legend: {{ data: ['收入', '支出'], textStyle: {{ color: '#8b949e' }}, top: 0 }},
  grid: {{ left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true }},
  xAxis: {{ type: 'category', data: REPORT_DATA.monthlyData.map(m => m.month), axisLabel: {{ color: '#8b949e' }} }},
  yAxis: {{ type: 'value', axisLabel: {{ color: '#8b949e', formatter: v => (v/1000) + 'k' }} }},
  series: [
    {{ name: '收入', type: 'bar', data: REPORT_DATA.monthlyData.map(m => m.income), itemStyle: {{ color: '#3fb950' }} }},
    {{ name: '支出', type: 'bar', data: REPORT_DATA.monthlyData.map(m => m.expense), itemStyle: {{ color: '#f85149' }} }}
  ]
}});

// 3. 渠道分布
const channelChart = echarts.init(document.getElementById('channelChart'));
channelChart.setOption({{
  tooltip: {{ trigger: 'axis', formatter: p => p[0].name + '<br/>¥' + p[0].value + ' (' + REPORT_DATA.channelData[p[0].dataIndex].count + '笔)' }},
  grid: {{ left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true }},
  xAxis: {{ type: 'category', data: REPORT_DATA.channelData.map(c => c.name), axisLabel: {{ color: '#8b949e' }} }},
  yAxis: {{ type: 'value', axisLabel: {{ color: '#8b949e', formatter: v => (v/1000) + 'k' }} }},
  series: [{{
    type: 'bar',
    data: REPORT_DATA.channelData.map(c => c.value),
    itemStyle: {{ color: '#58a6ff', borderRadius: [6, 6, 0, 0] }},
    barWidth: '40%'
  }}]
}});

// 4. Top 10 表格
const topTable = document.getElementById('topTable');
topTable.innerHTML = REPORT_DATA.topExpenses.map((t, i) => `
  <tr>
    <td style="color:#8b949e">${{i+1}}</td>
    <td>${{t.date}}</td>
    <td class="amount-expense">¥${{t.amount.toFixed(2)}}</td>
    <td>${{t.desc}}</td>
    <td><span class="category-tag" style="background:${{COLORS[i % COLORS.length]}}22;color:${{COLORS[i % COLORS.length]}}">${{t.category}}</span></td>
    <td style="color:#8b949e">${{t.channel}}</td>
  </tr>
`).join('');

// 5. 全部交易表格 + 筛选
const txTable = document.getElementById('txTable');
const categoryFilter = document.getElementById('categoryFilter');
const directionFilter = document.getElementById('directionFilter');
const searchInput = document.getElementById('searchInput');

// 填充分类筛选器
const categories = [...new Set(REPORT_DATA.transactions.map(t => t.category))];
categoryFilter.innerHTML = '<option value="">全部分类</option>' +
  categories.map(c => `<option value="${{c}}">${{c}}</option>`).join('');

function renderTable() {{
  const cat = categoryFilter.value;
  const dir = directionFilter.value;
  const search = searchInput.value.toLowerCase();
  const filtered = REPORT_DATA.transactions.filter(t => {{
    if (cat && t.category !== cat) return false;
    if (dir && t.direction !== dir) return false;
    if (search && !`${{t.counterparty}} ${{t.counterparty_bank}} ${{t.summary}} ${{t.remark}} ${{t.channel_method}}`.toLowerCase().includes(search)) return false;
    return true;
  }});
  txTable.innerHTML = filtered.map(t => {{
    const amtClass = t.direction === 'income' ? 'amount-income' : 'amount-expense';
    const dirLabel = t.direction === 'income' ? '收入' : t.direction === 'transfer' ? '转账' : '支出';
    const sign = t.direction === 'income' ? '+' : '-';
    const catColor = COLORS[categories.indexOf(t.category) % COLORS.length] || '#8b949e';
    return `<tr>
      <td>${{t.date}}</td>
      <td style="color:#8b949e">${{dirLabel}}</td>
      <td class="${{amtClass}}">${{sign}}¥${{t.amount.toFixed(2)}}</td>
      <td>${{t.summary || t.counterparty}}<br><span style="color:#8b949e;font-size:11px">${{t.counterparty}}</span></td>
      <td><span class="category-tag" style="background:${{catColor}}22;color:${{catColor}}">${{t.category}}</span></td>
      <td style="color:#8b949e">${{t.channel}}</td>
    </tr>`;
  }}).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#8b949e">没有匹配的记录</td></tr>';
}}

categoryFilter.addEventListener('change', renderTable);
directionFilter.addEventListener('change', renderTable);
searchInput.addEventListener('input', renderTable);
renderTable();

// 响应式
window.addEventListener('resize', () => {{
  pieChart.resize();
  barChart.resize();
  channelChart.resize();
}});
</script>

</body>
</html>'''


# ============================================================
# 6. 主函数（CLI 入口）
# ============================================================

def main():
    print()
    print("=" * 50)
    print("  个人账单分析工具 v1.1")
    print("=" * 50)
    print()

    if len(sys.argv) < 2:
        print("用法: python analyze.py <CSV或PDF文件路径> [选项]")
        print()
        print("选项:")
        print("  --output <文件名>    输出 HTML 文件名 (默认: report.html)")
        print("  --title <标题>       报告标题 (默认: 个人账单分析报告)")
        print("  --categories <文件>  自定义分类关键词 JSON 文件")
        print()
        print("示例:")
        print('  python analyze.py bank_statement.csv')
        print('  python analyze.py bank_statement.pdf')
        print('  python analyze.py 中原银行流水.pdf --output 7月报告.html')
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = "report.html"
    title = "个人账单分析报告"
    categories_file = None

    # 解析命令行参数
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--output" and i + 1 < len(sys.argv):
            output_file = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--title" and i + 1 < len(sys.argv):
            title = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--categories" and i + 1 < len(sys.argv):
            categories_file = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    # 检查文件
    if not os.path.exists(input_file):
        print(f"  [错误] 文件不存在: {input_file}")
        sys.exit(1)

    # 1. 解析文件（自动检测 CSV 或 PDF）
    print(f"  [1/3] 读取文件: {input_file}")
    is_pdf = input_file.lower().endswith('.pdf')
    if is_pdf:
        transactions, info = parse_pdf(input_file)
    else:
        transactions, info = parse_csv(input_file)
    if not transactions:
        print(f"  [错误] 解析失败: {info}")
        sys.exit(1)
    print(f"        {info}")
    print(f"        解析到 {len(transactions)} 条交易记录")
    print()

    # 2. 分类
    print(f"  [2/3] 智能分类中...")
    categories = load_categories(categories_file)
    for tx in transactions:
        categorize_transaction(tx, categories)

    # 打印分类摘要
    cat_summary = defaultdict(lambda: {"count": 0, "amount": 0.0})
    for t in transactions:
        if t.direction == "expense":
            cat_summary[t.category]["count"] += 1
            cat_summary[t.category]["amount"] += t.amount

    for cat, stats in sorted(cat_summary.items(), key=lambda x: x[1]["amount"], reverse=True):
        print(f"        {cat}: {stats['count']} 笔 (¥{stats['amount']:.2f})")
    print()

    # 3. 生成报告
    print(f"  [3/3] 生成报告: {output_file}")
    report_data = generate_report(transactions, output_file, title)
    print(f"        总收入: ¥{report_data['summary']['totalIncome']:,.2f}")
    print(f"        总支出: ¥{report_data['summary']['totalExpense']:,.2f}")
    print(f"        结余:   ¥{report_data['summary']['balance']:,.2f}")
    print(f"        结余率: {report_data['summary']['savingsRate']}%")
    print()
    print(f"  报告已生成: {os.path.abspath(output_file)}")
    print(f"  请在浏览器中打开查看")
    print()


if __name__ == "__main__":
    main()
