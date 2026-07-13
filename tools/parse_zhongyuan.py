#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中原银行加密PDF流水解析器
用法: python parse_zhongyuan.py --pdf <银行流水.pdf> [--pdf-password <密码>]
"""

import argparse
import io
import sys
import os
import re
import json
from datetime import datetime
from collections import defaultdict
from pathlib import Path

# 添加当前目录到 sys.path 以便导入 analyze
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import (
    Transaction, generate_report,
    DEFAULT_CATEGORIES, INCOME_KEYWORDS, load_categories
)

# 自定义转账/人情关键词（排除理财、贷款类，由分类引擎处理）
CUSTOM_TRANSFER_KEYWORDS = [
    "转账", "转出", "转入", "充值至他人支付账户",
    "扫二维码付款", "微信红包", "提现",
    "支付宝-充值至他人", "财付通-充值至他人",
    "微信转账", "支付宝转账"
]

def decrypt_pdf(input_path, password=None):
    """将 PDF 解密到内存，避免把明文账单落盘。"""
    from PyPDF2 import PdfReader, PdfWriter
    reader = PdfReader(str(input_path))
    if not reader.is_encrypted:
        return str(input_path)
    if not password:
        raise ValueError("PDF 已加密，请通过 --pdf-password 提供打开密码")
    result = reader.decrypt(password)
    if result == 0:
        raise ValueError("PDF 密码错误")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    decrypted = io.BytesIO()
    writer.write(decrypted)
    decrypted.seek(0)
    return decrypted


def extract_transactions_from_pdf(pdf_path):
    """从解密后的 PDF 中提取交易记录"""
    import pdfplumber

    all_transactions = []
    page_summaries = []
    skipped_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            if not tables:
                continue

            table = tables[0]
            if len(table) < 4:
                continue

            # 提取页面级别的汇总数据
            # Row 0: 账户交易流水 (title)
            # Row 1: 起始日期, 结束日期, 收入合计, ...
            # Row 2: 账户名称, 账号, 支出合计, ...
            # Row 3: 列标题
            # Row 4+: 数据行

            page_income = 0.0
            page_expense = 0.0

            for row in table[:4]:
                row_text = " ".join([str(c) for c in row if c])
                # 提取收入合计
                income_match = re.search(r'收入合计\s*([\d,.]+)', row_text)
                if income_match:
                    page_income = float(income_match.group(1).replace(",", ""))
                # 提取支出合计
                expense_match = re.search(r'支出合计\s*([\d,.]+)', row_text)
                if expense_match:
                    page_expense = float(expense_match.group(1).replace(",", ""))

            if page_income > 0 or page_expense > 0:
                page_summaries.append({
                    "page": page_num + 1,
                    "income": page_income,
                    "expense": page_expense
                })

            # 数据行从第4行开始
            for row in table[4:]:
                if not row or len(row) < 12:
                    continue

                # 检查是否是列标题重复
                row_text = " ".join([str(c) for c in row if c])
                if "交易日期" in row_text and "交易时间" in row_text:
                    continue

                date_str = (row[0] or "").strip()
                time_str = (row[1] or "").strip()
                amount_str = (row[2] or "").strip()
                direction_str = (row[3] or "").strip()
                # balance = row[4]  # 余额
                counterparty_bank = (row[5] or "").strip()
                counterparty = (row[6] or "").strip()
                counterparty_account = (row[7] or "").strip()
                channel_method = (row[8] or "").strip()
                # channel_type = row[9]  # 交易类型
                currency = (row[10] or "").strip()
                remark = (row[11] or "").strip()

                # 跳过空行
                if not date_str or not amount_str:
                    skipped_count += 1
                    continue

                # 清理金额
                amount_str_clean = amount_str.replace(",", "").replace("，", "").replace(" ", "")
                try:
                    amount = float(amount_str_clean)
                except ValueError:
                    skipped_count += 1
                    continue

                # 构造完整日期时间 (转为标准格式以便 analyze.py 解析)
                # 输入: 20260709 + 18:22:30 → 2026-07-09 18:22:30
                if len(date_str) == 8 and date_str.isdigit():
                    formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
                else:
                    formatted_date = date_str
                full_date_str = f"{formatted_date} {time_str}" if time_str else formatted_date

                # 判断收支方向
                if "支出" in direction_str:
                    direction = "expense"
                elif "收入" in direction_str:
                    direction = "income"
                else:
                    direction = "expense"

                # 构建附言/摘要(合并交易类型和附言)
                summary_parts = []
                if remark:
                    # 清理换行符
                    remark_clean = remark.replace("\n", ";").replace("\r", "")
                    summary_parts.append(remark_clean)
                if counterparty:
                    summary_parts.insert(0, counterparty)

                summary = "; ".join(summary_parts) if summary_parts else counterparty

                # 将渠道信息也加入
                if channel_method:
                    pass  # channel_method 在 Transaction 中已有独立字段

                tx = Transaction(
                    date_str=full_date_str,
                    amount=abs(amount),
                    direction=direction,
                    counterparty=counterparty,
                    summary=summary,
                    remark=remark.replace("\n", ";") if remark else "",
                    counterparty_bank=counterparty_bank,
                    channel_method=channel_method
                )

                # 如果是对手方银行字段为空但渠道有意义，设置对手方信息
                if not tx.counterparty_bank and channel_method:
                    tx.counterparty_bank = channel_method

                all_transactions.append(tx)

    print(f"  解析完成: {len(all_transactions)} 条交易记录, 跳过 {skipped_count} 行")
    return all_transactions, page_summaries


def categorize_transaction_custom(tx, categories):
    """自定义分类：收入/支出分别处理，长关键词优先匹配"""
    text = tx.full_text

    # 0. 退款
    if "退款" in text or "退货" in text:
        tx.category = "退款"
        return

    # === 收入交易特殊处理 ===
    if tx.direction == "income":
        if "公积金" in text:
            tx.category = "公积金提取"
        elif "报销" in text:
            tx.category = "报销收入"
        elif any(kw in text for kw in ["工资", "薪资", "代发", "奖金"]):
            tx.category = "工资收入"
        elif any(kw in text for kw in ["工资", "薪资", "代发"]):
            tx.category = "工资收入"
        else:
            tx.category = "其他收入"
        return

    # === 支出交易分类 ===
    # 先检查贷款还款（防止"京东白条"被"京东"抢匹配）
    for keyword in categories.get("贷款还款", []):
        if keyword in text:
            tx.category = "贷款还款"
            return

    # 再检查投资理财（防止"京东肯特瑞基金"被"京东"抢匹配）
    for keyword in categories.get("投资理财", []):
        if keyword in text:
            tx.category = "投资理财"
            return

    # 按类别匹配（长关键词优先，防止"京东"匹配到"京东肯特瑞"）
    for category, keywords in categories.items():
        if category in ("贷款还款", "投资理财"):
            continue  # 已处理
        # 按关键词长度降序排列，确保 "京东商城" 在 "京东" 之前匹配
        for keyword in sorted(keywords, key=len, reverse=True):
            if keyword in text:
                tx.category = category
                return

    # 检查是否是转账/红包
    for kw in CUSTOM_TRANSFER_KEYWORDS:
        if kw in text:
            tx.category = "转账/人情/红包"
            return

    # 兜底
    if tx.channel == "微信支付":
        tx.category = "微信支付(未识别)"
    elif tx.channel == "支付宝":
        tx.category = "支付宝(未识别)"
    else:
        tx.category = "其他消费"


def build_argument_parser():
    parser = argparse.ArgumentParser(description="银行流水 PDF 兼容解析器")
    parser.add_argument("--pdf", required=True, type=Path, help="银行流水 PDF 路径")
    parser.add_argument("--pdf-password", help="加密 PDF 的打开密码（仅保存在当前进程内存）")
    parser.add_argument("--output", type=Path, default=Path("report_bank.html"), help="HTML 报告路径")
    parser.add_argument("--csv-output", type=Path, help="可选：另存包含交易明细的 CSV")
    parser.add_argument("--categories", type=Path, default=Path("categories_enhanced.json"), help="分类规则 JSON")
    return parser


def main(argv=None):
    parser = build_argument_parser()
    args = parser.parse_args(argv)
    if not args.pdf.exists():
        parser.error(f"文件不存在：{args.pdf}")

    print()
    print("=" * 55)
    print("  中原银行流水分析工具")
    print("=" * 55)
    print()

    print("[1/4] 在内存中打开 PDF...")
    try:
        working_pdf = decrypt_pdf(args.pdf, args.pdf_password)
    except ValueError as exc:
        parser.error(str(exc))

    # Step 2: 提取交易数据
    print("[2/4] 提取交易数据...")
    transactions, page_summaries = extract_transactions_from_pdf(working_pdf)

    if not transactions:
        print("  [错误] 未提取到任何交易记录")
        sys.exit(1)

    # 打印页面汇总
    total_page_income = sum(p["income"] for p in page_summaries)
    total_page_expense = sum(p["expense"] for p in page_summaries)
    print(f"  页面汇总: 收入={total_page_income:.2f}, 支出={total_page_expense:.2f}")
    print(f"  (注意: 页面汇总为每页单独汇总，实际每笔交易已单独提取)")

    # Step 3: 分类
    print("[3/4] 智能分类中...")
    categories = load_categories(str(args.categories) if args.categories.exists() else None)
    for tx in transactions:
        categorize_transaction_custom(tx, categories)

    # 打印分类摘要
    income_stats = defaultdict(lambda: {"count": 0, "amount": 0.0})
    expense_stats = defaultdict(lambda: {"count": 0, "amount": 0.0})
    for t in transactions:
        if t.direction == "income":
            income_stats[t.category]["count"] += 1
            income_stats[t.category]["amount"] += t.amount
        else:
            expense_stats[t.category]["count"] += 1
            expense_stats[t.category]["amount"] += t.amount

    print()
    if income_stats:
        print("  【收入分类】")
        for cat, stats in sorted(income_stats.items(), key=lambda x: x[1]["amount"], reverse=True):
            print(f"    {cat:<20} {stats['count']:>4}笔  ¥{stats['amount']:>12.2f}")

    print()
    print("  【支出分类】")
    for cat, stats in sorted(expense_stats.items(), key=lambda x: x[1]["amount"], reverse=True):
        print(f"    {cat:<20} {stats['count']:>4}笔  ¥{stats['amount']:>12.2f}")

    # Step 4: 生成报告
    print()
    print("[4/4] 生成 HTML 报告...")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report_data = generate_report(transactions, str(args.output), "银行流水分析报告")

    summary = report_data["summary"]
    print()
    print("=" * 55)
    print("  分析结果")
    print("=" * 55)
    print(f"  数据范围:  {report_data['dateRange']}")
    print(f"  总交易笔数: {summary['incomeCount'] + summary['expenseCount']}")
    print(f"    收入: {summary['incomeCount']} 笔")
    print(f"    支出: {summary['expenseCount']} 笔")
    print(f"    转账: {summary['transferCount']} 笔")
    print(f"  总收入:   ¥{summary['totalIncome']:>12,.2f}")
    print(f"  总支出:   ¥{summary['totalExpense']:>12,.2f}")
    print(f"  结余:     ¥{summary['balance']:>12,.2f}")
    print(f"  结余率:    {summary['savingsRate']}%")
    print()
    print(f"  报告已生成: {args.output.resolve()}")
    print(f"  请在浏览器中打开查看")
    print()

    if not args.csv_output:
        return str(args.output.resolve())

    # CSV 包含完整交易明细，仅在用户明确指定时生成。
    import csv as csv_module
    args.csv_output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.csv_output, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv_module.writer(f)
        writer.writerow(["交易日期", "交易时间", "月份", "金额", "收/支", "对方行名", "对方户名", "对方账号", "交易渠道", "分类", "附言"])
        for tx in sorted(transactions, key=lambda t: t.date_str, reverse=True):
            # date_str 格式: "2026-07-09 18:22:30"
            parts = tx.date_str.split(" ", 1)
            date_part = parts[0] if parts else tx.date_str
            time_part = parts[1] if len(parts) > 1 else ""

            direction_label = "收入" if tx.direction == "income" else "支出"

            # 清理换行符
            def clean(s):
                return (s or "").replace("\n", " ").replace("\r", "").replace(",", "，")

            writer.writerow([
                date_part, time_part, tx.month,
                f"{tx.amount:.2f}", direction_label,
                clean(tx.counterparty_bank), clean(tx.counterparty),
                "", clean(tx.channel_method),
                tx.category, clean(tx.summary)
            ])
    print(f"  CSV 备份已保存: {args.csv_output.resolve()}")
    print()
    return str(args.output.resolve())


if __name__ == "__main__":
    main()
