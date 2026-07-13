#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模拟银行流水数据生成器
生成 6 个月（2026年1-6月）的真实银行流水 CSV 数据
包含：工资收入、微信/支付宝消费、各类分类支出、退款、转账
"""

import csv
import random
from datetime import datetime, timedelta

random.seed(42)  # 可复现

OUTPUT_FILE = "sample_data.csv"

# CSV 表头（模拟招商银行格式）
HEADER = ["交易日期", "交易时间", "收/支", "交易金额", "对方户名", "摘要", "备注"]

# 工资收入
SALARY = {
    "counterparty": "河南XX科技有限公司",
    "summary": "代发工资",
    "remark": "月度工资",
    "amount": 8500,
    "day": 10,  # 每月10号发工资
}

# 支出模板：(摘要, 对方户名, 分类关键词, 金额范围, 出现频率权重)
# 对方户名模拟银行流水中的真实显示
EXPENSE_TEMPLATES = [
    # 餐饮美食
    ("财付通-美团外卖", "财付通支付科技有限公司", "美团", (18, 55), 10),
    ("财付通-饿了么", "财付通支付科技有限公司", "饿了么", (15, 50), 5),
    ("财付通-瑞幸咖啡", "财付通支付科技有限公司", "瑞幸", (9, 18), 8),
    ("财付通-星巴克", "财付通支付科技有限公司", "星巴克", (28, 38), 3),
    ("财付通-蜜雪冰城", "财付通支付科技有限公司", "蜜雪冰城", (4, 12), 6),
    ("财付通-便利店", "财付通支付科技有限公司", "便利店", (5, 20), 4),
    ("财付通-海底捞", "财付通支付科技有限公司", "海底捞", (120, 280), 1),
    ("支付宝-早餐", "支付宝(中国)网络技术有限公司", "早餐", (5, 15), 6),

    # 交通出行
    ("财付通-滴滴出行", "财付通支付科技有限公司", "滴滴", (8, 45), 7),
    ("支付宝-滴滴出行", "支付宝(中国)网络技术有限公司", "滴滴", (8, 45), 4),
    ("支付宝-12306火车票", "支付宝(中国)网络技术有限公司", "12306", (55, 350), 1),
    ("财付通-地铁", "财付通支付科技有限公司", "地铁", (2, 8), 5),
    ("财付通-哈啰单车", "财付通支付科技有限公司", "哈啰", (2, 5), 3),
    ("支付宝-加油", "支付宝(中国)网络技术有限公司", "加油", (200, 400), 1),

    # 购物消费
    ("支付宝-淘宝购物", "支付宝(中国)网络技术有限公司", "淘宝", (30, 500), 5),
    ("财付通-京东商城", "财付通支付科技有限公司", "京东", (50, 800), 3),
    ("支付宝-拼多多", "支付宝(中国)网络技术有限公司", "拼多多", (10, 100), 4),
    ("财付通-盒马鲜生", "财付通支付科技有限公司", "盒马", (30, 150), 3),
    ("支付宝-永辉超市", "支付宝(中国)网络技术有限公司", "永辉", (40, 200), 2),

    # 生活缴费
    ("支付宝-电费", "支付宝(中国)网络技术有限公司", "电费", (80, 200), 1),
    ("支付宝-水费", "支付宝(中国)网络技术有限公司", "水费", (20, 50), 1),
    ("支付宝-燃气费", "支付宝(中国)网络技术有限公司", "燃气", (30, 80), 1),
    ("支付宝-中国移动话费", "支付宝(中国)网络技术有限公司", "中国移动", (49, 99), 1),
    ("支付宝-宽带费", "支付宝(中国)网络技术有限公司", "宽带", (50, 120), 1),

    # 娱乐休闲
    ("财付通-猫眼电影", "财付通支付科技有限公司", "猫眼", (35, 80), 2),
    ("财付通-腾讯视频会员", "财付通支付科技有限公司", "腾讯视频", (15, 25), 1),
    ("支付宝-网易云音乐", "支付宝(中国)网络技术有限公司", "网易云", (8, 15), 1),
    ("财付通-Steam游戏", "财付通支付科技有限公司", "Steam", (30, 200), 1),

    # 医疗健康
    ("支付宝-药店", "支付宝(中国)网络技术有限公司", "药店", (15, 80), 1),
    ("财付通-体检", "财付通支付科技有限公司", "体检", (200, 500), 0.3),

    # 教育学习
    ("支付宝-极客时间课程", "支付宝(中国)网络技术有限公司", "极客时间", (99, 299), 0.5),
    ("财付通-当当图书", "财付通支付科技有限公司", "当当", (30, 80), 0.5),

    # 未分类（只有支付渠道，无商户信息）
    ("财付通-消费", "财付通支付科技有限公司", "", (5, 30), 3),
    ("支付宝-消费", "支付宝(中国)网络技术有限公司", "", (5, 30), 2),
]

# 退款模板
REFUND_TEMPLATES = [
    ("财付通-退款", "财付通支付科技有限公司", "美团", (10, 50)),
    ("支付宝-退款", "支付宝(中国)网络技术有限公司", "淘宝", (20, 100)),
]

# 转账模板
TRANSFER_TEMPLATES = [
    ("财付通-转账", "财付通支付科技有限公司", "转账", (100, 1000)),
    ("支付宝-转账", "支付宝(中国)网络技术有限公司", "转账", (100, 500)),
]


def random_date(year, month):
    """随机生成某月的一天"""
    if month == 12:
        last_day = 31
    else:
        last_day = (datetime(year, month + 1, 1) - timedelta(days=1)).day
    day = random.randint(1, last_day)
    return datetime(year, month, day)


def random_time():
    """随机生成时间"""
    hour = random.randint(7, 22)
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    return f"{hour:02d}:{minute:02d}:{second:02d}"


def generate_transactions():
    """生成 6 个月的数据"""
    transactions = []
    year = 2026

    for month in range(1, 7):
        # 1. 工资收入
        dt = datetime(year, month, SALARY["day"])
        transactions.append({
            "date": dt.strftime("%Y-%m-%d"),
            "time": "09:00:00",
            "direction": "收入",
            "amount": SALARY["amount"],
            "counterparty": SALARY["counterparty"],
            "summary": SALARY["summary"],
            "remark": SALARY["remark"],
        })

        # 2. 日常消费
        for template in EXPENSE_TEMPLATES:
            summary, counterparty, keyword, amount_range, weight = template
            # 根据权重决定出现次数
            count = max(0, int(random.gauss(weight, weight * 0.3)))
            for _ in range(count):
                dt = random_date(year, month)
                amount = round(random.uniform(*amount_range), 2)
                transactions.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "time": random_time(),
                    "direction": "支出",
                    "amount": amount,
                    "counterparty": counterparty,
                    "summary": summary,
                    "remark": "",
                })

        # 3. 退款（偶尔出现）
        if random.random() < 0.4:
            template = random.choice(REFUND_TEMPLATES)
            summary, counterparty, keyword, amount_range = template
            dt = random_date(year, month)
            amount = round(random.uniform(*amount_range), 2)
            transactions.append({
                "date": dt.strftime("%Y-%m-%d"),
                "time": random_time(),
                "direction": "收入",
                "amount": amount,
                "counterparty": counterparty,
                "summary": summary,
                "remark": "退款",
            })

        # 4. 转账（偶尔）
        if random.random() < 0.5:
            template = random.choice(TRANSFER_TEMPLATES)
            summary, counterparty, keyword, amount_range = template
            dt = random_date(year, month)
            amount = round(random.uniform(*amount_range), 2)
            transactions.append({
                "date": dt.strftime("%Y-%m-%d"),
                "time": random_time(),
                "direction": "支出",
                "amount": amount,
                "counterparty": counterparty,
                "summary": summary,
                "remark": "",
            })

    # 按日期排序
    transactions.sort(key=lambda t: t["date"] + t["time"])
    return transactions


def write_csv(transactions, filepath):
    """写入 CSV 文件"""
    with open(filepath, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(HEADER)
        for tx in transactions:
            writer.writerow([
                tx["date"], tx["time"], tx["direction"],
                f'{tx["amount"]:.2f}', tx["counterparty"],
                tx["summary"], tx["remark"]
            ])
    print(f"  生成 {len(transactions)} 条交易记录 -> {filepath}")


if __name__ == "__main__":
    print()
    print("  模拟银行流水数据生成器")
    print("-" * 40)
    txs = generate_transactions()
    write_csv(txs, OUTPUT_FILE)

    # 简单统计
    income = sum(t["amount"] for t in txs if t["direction"] == "收入")
    expense = sum(t["amount"] for t in txs if t["direction"] == "支出")
    print(f"  总收入: ¥{income:.2f}")
    print(f"  总支出: ¥{expense:.2f}")
    print(f"  结余:   ¥{income - expense:.2f}")
    print()
