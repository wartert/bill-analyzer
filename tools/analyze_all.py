#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
三源合一账单分析引擎
数据源：银行卡PDF + 微信XLSX + 支付宝CSV → 去重 → 统一分类 → 分析报告
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from pathlib import Path

BASE_DIR = Path(__file__).parent

# ============================================================
# 统一分类体系
# ============================================================
CATEGORY_RULES = [
    # (类别, 关键词列表, 优先级)
    ("🍔 餐饮美食", [
        "餐饮", "美食", "餐厅", "饭店", "小吃", "外卖", "食堂", "餐厅",
        "胡辣汤", "刀削面", "拉面", "牛肉面", "麻辣烫", "火锅", "烧烤",
        "蜜雪冰城", "瑞幸", "luckincoffee", "星巴克", "肯德基", "麦当劳",
        "茶百道", "古茗", "喜茶", "奈雪", "库迪",
        "曼玉", "朱家", "朱记", "土窑", "土菜馆", "椒麻鱼", "炒公鸡",
        "面馆", "饺子", "凉皮", "米线", "黄焖鸡", "螺蛳粉",
        "鸡排", "好面", "小笼包", "烤鱼", "酸菜鱼",
        "早餐", "午餐", "晚餐", "餐费",
    ]),
    ("🛒 购物消费", [
        "淘宝", "天猫", "京东商城", "拼多多", "唯品会", "得物", "闲鱼",
        "日用百货", "服饰", "鞋靴", "数码", "家电", "美妆", "护肤",
        "抖音电商", "超市", "便利店", "零食", "水果", "烤虾",
        "沃尔玛", "永辉", "大润发", "盒马", "名创优品", "屈臣氏",
        "多多平台", "实物商品",
    ]),
    ("🚗 交通出行", [
        "滴滴", "高德", "12306", "铁路", "火车票", "机票", "航空",
        "地铁", "公交", "出租车", "打车", "加油", "停车", "ETC",
        "客运站", "汽车站", "顺丰速运", "快递", "物流",
    ]),
    ("🏠 居住生活", [
        "电费", "水费", "燃气", "物业", "宽带", "话费", "房租", "租金",
        "充值缴费", "生活缴费", "手机充值", "流量",
    ]),
    ("🎮 娱乐休闲", [
        "电影", "猫眼", "淘票票", "KTV", "网吧", "游戏", "Steam",
        "腾讯视频", "爱奇艺", "优酷", "哔哩哔哩", "B站", "QQ音乐", "网易云",
        "健身", "游泳", "台球", "密室", "剧本杀",
        "文化休闲", "体育彩票", "福彩", "天游", "腾讯游戏",
        "直播", "抖音", "快手", "虎牙", "斗鱼",
    ]),
    ("📚 教育学习", [
        "书店", "培训", "课程", "网课", "图书", "学习", "考试", "报名",
        "深度求索", "DeepSeek", "极客时间", "得到", "知乎",
        "学费", "教材",
    ]),
    ("💊 医疗健康", [
        "医院", "药店", "诊所", "体检", "牙科", "眼科", "医药", "保健",
        "挂号", "保险", "社保", "医保",
    ]),
    ("💸 投资理财", [
        "基金", "理财", "余额宝", "零钱通", "蚂蚁", "肯特瑞",
        "申购", "赎回", "转入余额宝", "转出余额宝",
        "长信基金", "天弘基金", "易方达", "华夏基金",
        "小荷包", "攒钱",
    ]),
    ("💳 信用还款", [
        "花呗", "借呗", "白条", "信贷", "贷款还款", "还贷",
        "安逸花", "微粒贷", "美团借钱", "信用卡还款",
    ]),
    ("🧧 转账红包", [
        "微信红包", "群红包", "转账", "扫二维码付款",
        "充值至他人", "支付宝-充值至他人",
    ]),
    ("🧹 生活服务", [
        "理发", "美发", "美容", "洗衣", "家政", "维修", "保洁",
        "照相", "打印", "复印", "证件照",
    ]),
]

# 收入关键词
INCOME_KEYWORDS = [
    "工资", "薪资", "代发", "奖金", "报销", "公积金", "退税",
    "转入", "收款", "退款",
]

# 不计收支关键词（支付宝特有：余额宝转入转出、退款等）
NEUTRAL_KEYWORDS = [
    "余额宝-转入", "余额宝-转出", "余额宝-收益",
    "退款", "不计收支",
]

def classify_transaction(record):
    """统一分类"""
    # 已标记为内部流转的不再重新分类
    if record.get("direction") == "internal":
        if record.get("category") != "🔄 内部流转":
            record["category"] = "🔄 内部流转"
        return

    text = record.get("search_text", "")

    # 退款
    if "退款" in text and record["direction"] != "income":
        record["category"] = "↩️ 退款"
        return

    # 收入
    if record["direction"] == "income":
        if "工资" in text or "薪资" in text or "代发" in text:
            record["category"] = "💰 工资收入"
        elif "报销" in text:
            record["category"] = "📋 报销收入"
        elif "公积金" in text:
            record["category"] = "🏦 公积金提取"
        elif "退款" in text:
            record["category"] = "↩️ 退款收入"
        else:
            record["category"] = "💵 其他收入"
        return

    # 不计收支（支付宝特有）
    if record["direction"] == "neutral":
        if "余额宝" in text:
            record["category"] = "💸 余额宝流转"
        elif "退款" in text:
            record["category"] = "↩️ 退款"
        elif "基金" in text or "理财" in text:
            record["category"] = "💸 投资理财"
        else:
            record["category"] = "🔄 内部流转"
        return

    # 支出分类
    for category, keywords in CATEGORY_RULES:
        for kw in sorted(keywords, key=len, reverse=True):
            if kw in text:
                record["category"] = category
                return

    # 兜底
    channel = record.get("channel", "")
    if "微信" in channel or "财付通" in channel:
        record["category"] = "📱 微信消费"
    elif "支付宝" in channel or "花呗" in channel:
        record["category"] = "📱 支付宝消费"
    else:
        record["category"] = "❓ 其他消费"


# ============================================================
# 1. 银行PDF解析
# ============================================================
def parse_bank_pdf(pdf_path, password=None):
    import pdfplumber
    from PyPDF2 import PdfReader, PdfWriter

    reader = PdfReader(str(pdf_path))
    if reader.is_encrypted:
        if not password:
            raise ValueError("银行 PDF 已加密，请通过 --pdf-password 提供打开密码")
        if reader.decrypt(password) == 0:
            raise ValueError("银行 PDF 密码错误")

    # 在内存中解密，避免把明文账单写到磁盘。
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    decrypted = io.BytesIO()
    writer.write(decrypted)
    decrypted.seek(0)

    records = []
    with pdfplumber.open(decrypted) as pdf:
        for page_num, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            if not tables:
                continue
            for table in tables:
                for row in table:
                    if not row or len(row) < 12:
                        continue
                    row_text = " ".join([str(c) for c in row if c])
                    if "交易日期" in row_text and "交易时间" in row_text:
                        continue
                    if any(kw in row_text for kw in ["账户交易流水", "起始日期", "账户名称"]):
                        continue

                    date_val = (row[0] or "").strip()
                    time_val = (row[1] or "").strip()
                    amt_val = (row[2] or "").strip()
                    dir_val = (row[3] or "").strip()
                    cp_bank = (row[5] or "").strip()
                    cp_name = (row[6] or "").strip()
                    cp_acct = (row[7] or "").strip()
                    channel = (row[8] or "").strip()
                    remark = (row[11] or "").strip().replace("\n", " ")

                    if not date_val or not amt_val:
                        continue

                    try:
                        amount = float(amt_val.replace(",", "").replace(" ", ""))
                    except ValueError:
                        continue

                    direction = "income" if "收入" in dir_val else "expense"

                    # 格式化日期
                    if len(date_val) == 8 and date_val.isdigit():
                        formatted_date = f"{date_val[:4]}-{date_val[4:6]}-{date_val[6:8]}"
                    else:
                        formatted_date = date_val
                    datetime_str = f"{formatted_date} {time_val}" if time_val else formatted_date

                    search_text = f"{cp_bank} {cp_name} {remark} {channel}"
                    rec = {
                        "date": formatted_date,
                        "time": time_val,
                        "datetime": datetime_str,
                        "amount": round(abs(amount), 2),
                        "direction": direction,
                        "merchant": cp_name,
                        "merchant_account": cp_acct,
                        "description": remark,
                        "channel": channel,
                        "payment_method": "银行卡",
                        "source": "bank",
                        "search_text": search_text,
                        "matched": False,
                    }
                    records.append(rec)

    return records


# ============================================================
# 2. 微信XLSX解析
# ============================================================
def parse_wechat_xlsx(xlsx_path):
    import openpyxl
    wb = openpyxl.load_workbook(str(xlsx_path), data_only=True)
    ws = wb.active

    records = []
    in_data = False
    for row in ws.iter_rows(values_only=True):
        vals = [str(c).strip() if c is not None else "" for c in row]
        row_text = " ".join(vals)

        # 检测数据开始
        if "交易时间" in row_text and "交易类型" in row_text and "交易对方" in row_text:
            in_data = True
            continue
        if not in_data:
            continue
        # 检测数据结束
        if "----------------------" in row_text or not vals[0]:
            continue

        if len(vals) < 6:
            continue

        time_str = vals[0]
        tx_type = vals[1]
        counterparty = vals[2]
        product = vals[3]
        direction_str = vals[4]
        amount_str = vals[5]
        payment_method = vals[6] if len(vals) > 6 else ""
        status = vals[7] if len(vals) > 7 else ""
        remark = vals[10] if len(vals) > 10 else ""

        if not time_str or not amount_str:
            continue

        try:
            amount = float(amount_str.replace(",", "").replace("¥", "").replace("￥", ""))
        except ValueError:
            continue

        if "收入" in direction_str:
            direction = "income"
        elif "支出" in direction_str:
            direction = "expense"
        else:
            direction = "neutral"

        date_part = time_str[:10] if len(time_str) >= 10 else time_str
        search_text = f"{tx_type} {counterparty} {product} {payment_method} {remark}"

        rec = {
            "date": date_part,
            "time": time_str[11:19] if len(time_str) > 11 else "",
            "datetime": time_str,
            "amount": round(abs(amount), 2),
            "direction": direction,
            "merchant": counterparty,
            "merchant_account": "",
            "description": f"{tx_type}: {product}".strip(": "),
            "channel": "微信支付",
            "payment_method": payment_method,
            "source": "wechat",
            "search_text": search_text,
            "matched": False,
            "raw_type": tx_type,
        }
        records.append(rec)

    return records


# ============================================================
# 3. 支付宝CSV解析 (GBK)
# ============================================================
def parse_alipay_csv(csv_path):
    records = []
    in_data = False

    with open(str(csv_path), "r", encoding="gb18030", errors="replace", newline="") as f:
        for parts in csv.reader(f):
            row_text = " ".join(parts).strip()
            if "交易时间" in row_text and "交易对方" in row_text:
                in_data = True
                continue
            if not in_data or not row_text:
                continue
            if "------------------------------------------------------------------------------------" in row_text:
                continue

            if len(parts) < 11:
                continue

            time_str = parts[0].strip()
            alipay_category = parts[1].strip() if len(parts) > 1 else ""
            counterparty = parts[2].strip() if len(parts) > 2 else ""
            counterparty_acct = parts[3].strip() if len(parts) > 3 else ""
            product = parts[4].strip() if len(parts) > 4 else ""
            direction_str = parts[5].strip() if len(parts) > 5 else ""
            amount_str = parts[6].strip() if len(parts) > 6 else ""
            payment_method = parts[7].strip() if len(parts) > 7 else ""
            status = parts[8].strip() if len(parts) > 8 else ""
            # parts[9] 交易订单号
            # parts[10] 商家订单号
            remark = parts[11].strip() if len(parts) > 11 else ""

            if not time_str or not amount_str:
                continue
            if any(keyword in status for keyword in ("失败", "关闭", "取消", "撤销")):
                continue

            try:
                amount = float(amount_str.replace(",", "").replace("¥", ""))
            except ValueError:
                continue

            if "收入" in direction_str:
                direction = "income"
            elif "不计收支" in direction_str:
                direction = "neutral"
            else:
                direction = "expense"

            date_part = time_str[:10] if len(time_str) >= 10 else time_str
            search_text = f"{alipay_category} {counterparty} {product} {payment_method} {remark}"

            rec = {
                "date": date_part,
                "time": time_str[11:19] if len(time_str) > 11 else "",
                "datetime": time_str,
                "amount": round(abs(amount), 2),
                "direction": direction,
                "merchant": counterparty,
                "merchant_account": counterparty_acct,
                "description": product or alipay_category,
                "channel": "支付宝",
                "payment_method": payment_method,
                "source": "alipay",
                "search_text": search_text,
                "matched": False,
                "raw_category": alipay_category,
            }
            records.append(rec)

    return records


# ============================================================
# 去重引擎：银行卡 ↔ 微信/支付宝
# ============================================================
def deduplicate(all_records):
    """
    银行卡流水中的「财付通/支付宝」支付记录 与 微信/支付宝账单中的记录
    是同一次交易的两个视角。通过 时间(±3秒) + 金额(精确) 匹配。
    匹配后保留微信/支付宝的详细描述，标记银行卡记录为 matched
    """
    bank_records = [r for r in all_records if r["source"] == "bank"]
    detail_records = [r for r in all_records if r["source"] in ("wechat", "alipay")]

    # 建立详细记录索引：(date, amount) → list of records
    detail_index = defaultdict(list)
    for r in detail_records:
        key = (r["date"], round(r["amount"], 2))
        detail_index[key].append(r)

    matched_count = 0
    for bank_r in bank_records:
        # 只看银行卡中走财付通/支付宝渠道的
        channel = bank_r["channel"]
        if "财付通" not in channel and "微信" not in channel and "支付宝" not in channel and "银联" not in channel:
            continue

        key = (bank_r["date"], round(bank_r["amount"], 2))
        candidates = detail_index.get(key, [])

        best_match = None
        best_diff = 999
        bank_time = bank_r.get("time", "")

        for c in candidates:
            if c.get("matched"):
                continue
            c_time = c.get("time", "")
            if bank_time and c_time:
                try:
                    t1 = bank_time.split(":")
                    t2 = c_time.split(":")
                    diff = abs((int(t1[0])*3600 + int(t1[1])*60 + int(t1[2])) -
                               (int(t2[0])*3600 + int(t2[1])*60 + int(t2[2])))
                except (ValueError, IndexError):
                    diff = 0  # 无法解析时间，依然按金额匹配
            else:
                diff = 0

            if diff <= 3 and diff < best_diff:
                best_match = c
                best_diff = diff

        if best_match:
            bank_r["matched"] = True
            bank_r["matched_to"] = best_match["source"]
            best_match["matched"] = True
            best_match["matched_from"] = "bank"
            matched_count += 1

    print(f"  去重匹配: {matched_count} 笔银行卡交易与微信/支付宝明细关联")

    return all_records


# ============================================================
# 分析引擎
# ============================================================
def is_internal_transfer(r, self_names=None):
    """检测是否为内部账户间流转（不算真实收入/支出）"""
    text = r.get("search_text", "") + r.get("description", "") + r.get("merchant", "")

    # 银行卡→自己的支付宝/微信（对方是自己 + 走支付渠道）
    if r["source"] == "bank":
        merchant = r.get("merchant", "")
        if merchant and merchant in set(self_names or []):
            return True
        # 银行卡直接充值到支付宝余额宝/小荷包/零钱通
        if any(kw in text for kw in ["小荷包", "余额宝-自动转入", "零钱通"]):
            return True

    # 支付宝内部流转
    if r["source"] == "alipay":
        # 小荷包相关：转入/转出都是内部流转
        if "小荷包" in text:
            # 小荷包转出到银行卡 → 不是真实收入，是内部资金回流
            return True
        # 余额宝转入转出
        if any(kw in text for kw in ["余额宝-转入", "余额宝-转出", "余额宝-自动转入"]):
            return True
        # 花呗还款
        if r["direction"] == "neutral" and "还款" in text:
            return True
        # 基金/理财申购（支付宝侧显示为不计收支）
        if r["direction"] == "neutral" and any(kw in text for kw in ["买入", "申购", "卖出", "赎回"]):
            return True
        # 退款不算内部流转
        if "退款" in text:
            return False
        # 收益发放是真实收入（虽然很小）
        if "收益发放" in text:
            return False
        # 余额宝收益
        if "余额宝" in text and "收益" in text:
            return False

    # 微信零钱充值（从银行卡到微信零钱）
    if r["source"] == "wechat":
        raw_type = r.get("raw_type", "")
        if raw_type in ["零钱充值", "转入零钱"]:
            return True

    return False


def analyze(all_records, self_names=None):
    """生成全维度分析数据"""
    now = datetime.now()

    # Step 0: 标记内部流转
    for r in all_records:
        if is_internal_transfer(r, self_names):
            r["direction"] = "internal"
            r["category"] = "🔄 内部流转"

    # Step 1: 银行↔微信/支付宝 匹配
    # 1a: 先匹配消费明细（银行支出 ↔ 微信/支付宝支出）
    bank_expenses = [r for r in all_records if r["source"] == "bank" and r["direction"] == "expense"]
    detail_expenses = [r for r in all_records if r["source"] in ("wechat", "alipay") and r["direction"] == "expense"]
    detail_neutral = [r for r in all_records if r["source"] in ("wechat", "alipay") and r["direction"] in ("neutral", "internal")]

    def match_time(bank_time, detail_time):
        try:
            return abs((int(bank_time[:2])*3600+int(bank_time[3:5])*60+int(bank_time[6:8])) -
                       (int(detail_time[:2])*3600+int(detail_time[3:5])*60+int(detail_time[6:8])))
        except:
            return 0

    # 建立索引
    exp_index = defaultdict(list)
    for r in detail_expenses:
        exp_index[(r["date"], round(r["amount"], 2))].append(r)

    neu_index = defaultdict(list)
    for r in detail_neutral:
        neu_index[(r["date"], round(r["amount"], 2))].append(r)

    matched_pairs = []
    for bank_r in bank_expenses:
        key = (bank_r["date"], round(bank_r["amount"], 2))
        bt = bank_r.get("time", "")

        # 先尝试匹配消费明细
        best = None
        best_diff = 999
        for c in exp_index.get(key, []):
            if c.get("_matched"):
                continue
            diff = match_time(bt, c.get("time", ""))
            if diff <= 5 and diff < best_diff:
                best = c
                best_diff = diff

        # 再尝试匹配中性记录（花呗还款、基金申购等走支付宝但显示为不计收支的）
        if not best:
            for c in neu_index.get(key, []):
                if c.get("_matched"):
                    continue
                diff = match_time(bt, c.get("time", ""))
                if diff <= 5 and diff < best_diff:
                    best = c
                    best_diff = diff

        if best:
            bank_r["_matched_to"] = best["source"]
            best["_matched"] = True
            matched_pairs.append((bank_r, best))

    print(f"      银行↔微信/支付宝匹配: {len(matched_pairs)} 对")
    matched_to_expense = sum(1 for _, d in matched_pairs if d["direction"] == "expense")
    matched_to_neutral = sum(1 for _, d in matched_pairs if d["direction"] in ("neutral", "internal"))
    print(f"        (消费明细: {matched_to_expense}, 还款/理财等: {matched_to_neutral})")

    # 后处理：银行匹配到支付宝中性记录
    # - 花呗/白条/信贷还款 → 真正消费已在支付宝花呗支出中，保持中性
    # - 小荷包转入/转出 → 内部流转，保持中性
    # - 基金/理财申购 → 真实投资，改为支出(投资理财)
    INTERNAL_PATTERNS = ["还款", "还贷", "小荷包", "余额宝-转入", "余额宝-自动转入", "零钱通"]

    for bank_r, detail_r in matched_pairs:
        if detail_r["direction"] in ("neutral", "internal"):
            detail_text = detail_r.get("description", "") + detail_r.get("merchant", "")
            if any(kw in detail_text for kw in INTERNAL_PATTERNS):
                # 还款/小荷包/余额宝流转：保持中性/内部
                detail_r["category"] = "🔄 内部流转"
            else:
                # 基金/理财申购：改为支出
                detail_r["direction"] = "expense"
                detail_r["category"] = "💸 投资理财"

    # Step 2: 构建干净的收/支列表
    income_list = []
    expense_list = []
    internal_list = []

    for r in all_records:
        if r["direction"] == "internal":
            internal_list.append(r)
            continue

        if r["direction"] == "income":
            # 银行卡收入：全部真实（工资、报销等）
            if r["source"] == "bank":
                income_list.append(r)
            # 微信收入：排除红包收入（是别人发的，本质是内部流转不是收入）
            elif r["source"] == "wechat":
                raw_type = r.get("raw_type", "")
                if "红包" not in raw_type:
                    income_list.append(r)
                else:
                    internal_list.append(r)
            # 支付宝收入
            elif r["source"] == "alipay":
                income_list.append(r)

        elif r["direction"] == "expense":
            # 银行支出：如果已匹配到微信/支付宝明细，跳过（由明细替代）
            if r["source"] == "bank":
                if not r.get("_matched_to"):
                    expense_list.append(r)
            # 微信/支付宝支出：全部保留（这些是真实消费明细）
            else:
                expense_list.append(r)

        elif r["direction"] == "neutral":
            internal_list.append(r)

    # 去重：同一日期+金额+商户的去重
    seen = set()
    expense_unique = []
    for r in expense_list:
        key = (r["date"], round(r["amount"], 2), r["merchant"][:20])
        if key not in seen:
            seen.add(key)
            expense_unique.append(r)

    seen2 = set()
    income_unique = []
    for r in income_list:
        key = (r["date"], round(r["amount"], 2), r["merchant"][:20])
        if key not in seen2:
            seen2.add(key)
            income_unique.append(r)

    total_income = sum(r["amount"] for r in income_unique)
    total_expense = sum(r["amount"] for r in expense_unique)
    total_internal = sum(r["amount"] for r in internal_list if r["direction"] in ("internal", "neutral"))

    # 全部分类
    for r in all_records:
        classify_transaction(r)
    # 确保去重后记录也有分类
    for r in expense_unique:
        if "category" not in r:
            classify_transaction(r)
    for r in income_unique:
        if "category" not in r:
            classify_transaction(r)

    # === 分类汇总 ===
    cat_expense = defaultdict(lambda: {"amount": 0, "count": 0, "avg": 0})
    for r in expense_unique:
        c = r["category"]
        cat_expense[c]["amount"] += r["amount"]
        cat_expense[c]["count"] += 1

    cat_income = defaultdict(lambda: {"amount": 0, "count": 0})
    for r in income_unique:
        cat_income[r["category"]]["amount"] += r["amount"]
        cat_income[r["category"]]["count"] += 1
    cat_expense_sorted = sorted(cat_expense.items(), key=lambda x: x[1]["amount"], reverse=True)
    for k, v in cat_expense_sorted:
        v["avg"] = round(v["amount"] / v["count"], 2) if v["count"] else 0
    cat_income_sorted = sorted(cat_income.items(), key=lambda x: x[1]["amount"], reverse=True)

    # === 月度趋势 ===
    monthly = defaultdict(lambda: {"income": 0, "expense": 0, "neutral": 0, "count": 0})
    for r in income_unique:
        month = r["date"][:7] if len(r["date"]) >= 7 else "unknown"
        monthly[month]["income"] += r["amount"]
        monthly[month]["count"] += 1
    for r in expense_unique:
        month = r["date"][:7] if len(r["date"]) >= 7 else "unknown"
        monthly[month]["expense"] += r["amount"]
        monthly[month]["count"] += 1
    for r in internal_list:
        month = r["date"][:7] if len(r["date"]) >= 7 else "unknown"
        monthly[month]["neutral"] += r["amount"]
        monthly[month]["count"] += 1
    monthly_sorted = sorted(monthly.items())

    # === 商户Top ===
    merchant_expense = defaultdict(float)
    for r in expense_unique:
        name = r["merchant"] or r["description"][:20]
        merchant_expense[name] += r["amount"]
    merchant_top = sorted(merchant_expense.items(), key=lambda x: x[1], reverse=True)[:20]

    # === 支付方式 ===
    payment_methods = defaultdict(lambda: {"amount": 0, "count": 0})
    for r in expense_unique:
        pm = r.get("payment_method", "未知")
        # 简化支付方式名称
        if "储蓄卡" in pm or "银行卡" in pm:
            pm_short = "银行卡"
        elif "花呗" in pm:
            pm_short = "花呗"
        elif "余额" in pm or "余额宝" in pm:
            pm_short = "余额/余额宝"
        elif "零钱" in pm:
            pm_short = "微信零钱"
        else:
            pm_short = pm[:8]
        payment_methods[pm_short]["amount"] += r["amount"]
        payment_methods[pm_short]["count"] += 1
    pm_sorted = sorted(payment_methods.items(), key=lambda x: x[1]["amount"], reverse=True)

    # === 数据来源统计 ===
    source_stats = defaultdict(lambda: {"income": 0, "expense": 0, "neutral": 0, "total": 0})
    for r in all_records:
        s = r["source"]
        source_stats[s]["total"] += 1
        if r["direction"] == "income":
            source_stats[s]["income"] += r["amount"]
        elif r["direction"] == "expense":
            source_stats[s]["expense"] += r["amount"]
        else:
            source_stats[s]["neutral"] += r["amount"]

    # === 日均消费 ===
    dates = sorted(set(r["date"] for r in expense_unique if r["date"]))
    if dates:
        day_count = max((datetime.strptime(dates[-1], "%Y-%m-%d") -
                         datetime.strptime(dates[0], "%Y-%m-%d")).days, 1)
        daily_avg = total_expense / day_count
        date_range = f"{dates[0]} ~ {dates[-1]}"
    else:
        daily_avg = 0
        date_range = ""

    # === 高频消费模式 ===
    weekday_expense = defaultdict(lambda: {"amount": 0, "count": 0})
    for r in expense_unique:
        try:
            dt = datetime.strptime(r["date"], "%Y-%m-%d")
            wd = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][dt.weekday()]
            weekday_expense[wd]["amount"] += r["amount"]
            weekday_expense[wd]["count"] += 1
        except:
            pass
    weekday_sorted = sorted(weekday_expense.items(),
                            key=lambda x: ["周一","周二","周三","周四","周五","周六","周日"].index(x[0]))

    # 小时分布
    hour_expense = defaultdict(lambda: {"amount": 0, "count": 0})
    for r in expense_unique:
        t = r.get("time", "")
        if len(t) >= 2:
            try:
                h = int(t.split(":")[0])
                hour_expense[h]["amount"] += r["amount"]
                hour_expense[h]["count"] += 1
            except:
                pass
    hour_sorted = sorted(hour_expense.items())

    # === 大额支出 ===
    big_expenses = sorted(expense_unique, key=lambda r: r["amount"], reverse=True)[:30]

    # === 重复订阅/周期性消费检测 ===
    merchant_monthly = defaultdict(lambda: defaultdict(float))
    for r in expense_unique:
        m = r["date"][:7] if len(r["date"]) >= 7 else ""
        merchant_monthly[r["merchant"]][m] += r["amount"]
    recurring = []
    for merchant, months in merchant_monthly.items():
        if len(months) >= 3:
            total = sum(months.values())
            if total > 100:
                recurring.append({"merchant": merchant, "months": len(months), "total": round(total, 2)})
    recurring.sort(key=lambda x: x["total"], reverse=True)

    return {
        "meta": {
            "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            "date_range": date_range,
            "total_records": len(all_records),
            "bank_records": source_stats.get("bank", {}).get("total", 0),
            "wechat_records": source_stats.get("wechat", {}).get("total", 0),
            "alipay_records": source_stats.get("alipay", {}).get("total", 0),
        },
        "summary": {
            "total_income": round(total_income, 2),
            "total_expense": round(total_expense, 2),
            "balance": round(total_income - total_expense, 2),
            "savings_rate": round((total_income - total_expense) / total_income * 100, 1) if total_income > 0 else 0,
            "daily_avg": round(daily_avg, 2),
            "income_count": len(income_unique),
            "expense_count": len(expense_unique),
            "neutral_count": len(internal_list),
            "internal_total": round(total_internal, 2),
        },
        "categories": {
            "income": [{"name": k, "amount": round(v["amount"], 2), "count": v["count"]}
                        for k, v in cat_income_sorted],
            "expense": [{"name": k, "amount": round(v["amount"], 2), "count": v["count"],
                         "avg": v["avg"]} for k, v in cat_expense_sorted],
        },
        "monthly": [{"month": k, "income": round(v["income"], 2),
                      "expense": round(v["expense"], 2),
                      "neutral": round(v["neutral"], 2),
                      "net": round(v["income"] - v["expense"] - v.get("neutral", 0), 2)}
                     for k, v in monthly_sorted],
        "merchants": [{"name": k, "amount": round(v, 2)} for k, v in merchant_top],
        "payment_methods": [{"name": k, "amount": round(v["amount"], 2), "count": v["count"]}
                            for k, v in pm_sorted],
        "weekday": [{"name": k, "amount": round(v["amount"], 2), "count": v["count"]}
                    for k, v in weekday_sorted],
        "hourly": [{"hour": k, "amount": round(v["amount"], 2), "count": v["count"]}
                   for k, v in hour_sorted],
        "big_expenses": [{
            "date": r["date"], "amount": r["amount"], "merchant": r["merchant"],
            "description": r["description"], "category": r["category"],
            "payment_method": r.get("payment_method", ""), "source": r["source"]
        } for r in big_expenses[:30]],
        "recurring": recurring[:20],
        "source_stats": {k: {"income": round(v["income"], 2), "expense": round(v["expense"], 2),
                              "neutral": round(v["neutral"], 2), "total": v["total"]}
                         for k, v in source_stats.items()},
        # 全部交易记录
        "transactions": [{
            "date": r["date"], "time": r.get("time", ""), "amount": r["amount"],
            "direction": r["direction"], "merchant": r["merchant"],
            "description": r["description"], "category": r["category"],
            "channel": r.get("channel", ""), "payment_method": r.get("payment_method", ""),
            "source": r["source"]
        } for r in sorted(all_records, key=lambda x: x["datetime"], reverse=True)
           if not (r["source"] == "bank" and r.get("_matched_to"))  # 已被微信/支付宝明细替代的银行记录
        ],
    }


# ============================================================
# 建议生成引擎
# ============================================================
def generate_recommendations(analysis):
    """基于数据生成个性化建议"""
    recs = []
    summary = analysis["summary"]
    cat_expense = analysis["categories"]["expense"]
    monthly_data = analysis["monthly"]
    merchants = analysis["merchants"]
    weekday_data = analysis["weekday"]
    hourly_data = analysis["hourly"]
    payment_data = analysis["payment_methods"]
    recurring = analysis["recurring"]
    big_expenses = analysis["big_expenses"]

    # 建立分类金额映射
    cat_map = {c["name"]: c["amount"] for c in cat_expense}
    total_exp = summary["total_expense"]

    # 1. 储蓄率
    if summary["savings_rate"] >= 30:
        recs.append({
            "icon": "💰", "title": "储蓄表现优秀",
            "level": "good",
            "detail": f"本期结余率 {summary['savings_rate']}%。结余率会受到奖金、报销和一次性支出的影响，需要结合完整月份判断。",
            "action": "核对最近三个完整月的结余是否稳定，并为临时支出保留容易取用的现金缓冲。"
        })
    elif summary["savings_rate"] >= 10:
        recs.append({
            "icon": "📊", "title": "储蓄率尚可，建议提升",
            "level": "info",
            "detail": f"本期结余率 {summary['savings_rate']}%，保持正结余，但单期数据不足以判断长期趋势。",
            "action": "比较最近几个完整月，先从金额最高的可选消费分类寻找可执行的调整空间。"
        })
    else:
        recs.append({
            "icon": "⚠️", "title": "储蓄率偏低，需要关注",
            "level": "warning",
            "detail": f"本期结余率 {summary['savings_rate']}%，现金缓冲空间有限。先确认是否包含一次性大额支出或不完整月份。",
            "action": "逐项核对固定支出、周期性消费和大额交易，为下个完整月设置可执行的支出上限。"
        })

    # 2. 转账人情
    transfer_amt = cat_map.get("🧧 转账红包", 0)
    if transfer_amt > 10000:
        recs.append({
            "icon": "🧧", "title": "人情转账支出较高",
            "level": "warning" if transfer_amt > total_exp * 0.2 else "info",
            "detail": f"转账/红包类支出 ¥{transfer_amt:,.0f}，占总支出 {transfer_amt/total_exp*100:.0f}%。建议区分「必要人情」（父母、伴侣）和「社交开销」，为后者设定月度预算。",
            "action": "在微信/支付宝设置月度转账限额提醒，控制非必要红包和扫码付款。"
        })

    # 3. 信用还款
    credit_amt = cat_map.get("💳 信用还款", 0)
    if credit_amt > 5000:
        recs.append({
            "icon": "💳", "title": "信用还款需关注",
            "level": "warning" if credit_amt > total_exp * 0.3 else "info",
            "detail": f"识别到债务偿还相关资金流 ¥{credit_amt:,.0f}。还款不是新增消费，但可能影响当期现金流。",
            "action": "核对账单余额、还款日与费用说明；如现金流压力持续，优先向持牌机构或专业人士咨询。"
        })

    # 4. 投资理财
    invest_amt = cat_map.get("💸 投资理财", 0)
    if invest_amt > 0:
        recs.append({
            "icon": "📈", "title": "投资理财活跃",
            "level": "good",
            "detail": f"识别到资产变动 ¥{invest_amt:,.0f}。这部分不计入日常消费，也不能仅凭流水判断收益或风险。",
            "action": "与对应平台的资产明细核对本金、费用和持有状态；需要决策时结合自身风险承受能力并咨询专业人士。"
        })

    # 5. 餐饮分析
    food_amt = cat_map.get("🍔 餐饮美食", 0)
    if food_amt > 0:
        daily_food = food_amt / max((datetime.strptime(analysis["meta"]["date_range"].split(" ~ ")[1], "%Y-%m-%d") -
                                      datetime.strptime(analysis["meta"]["date_range"].split(" ~ ")[0], "%Y-%m-%d")).days, 1)
        recs.append({
            "icon": "🍔", "title": f"日均餐饮 ¥{daily_food:.0f}",
            "level": "good" if daily_food < 30 else ("warning" if daily_food > 60 else "info"),
            "detail": f"餐饮总支出 ¥{food_amt:,.0f}，日均 ¥{daily_food:.0f}。" +
                      ("控制得不错！" if daily_food < 30 else
                       ("偏高，建议减少外卖频率。" if daily_food > 60 else "在合理范围内。")),
            "action": "尝试每周带饭2-3次，可节省30-50%的餐饮支出。查看外卖APP的会员是否值得续费。"
        })

    # 6. 消费时间模式
    if hourly_data:
        night_amt = sum(item["amount"] for item in hourly_data if item["hour"] >= 22)
        if night_amt > 1000:
            recs.append({
                "icon": "🌙", "title": "夜间消费较多",
                "level": "info",
                "detail": f"22点后的消费共计 ¥{night_amt:,.0f}。深夜容易冲动消费，可以考虑开启APP的「屏幕使用时间限制」或设置「夜间购物冷静期」。",
                "action": "在手机设置22:30自动开启勿扰模式+灰度屏幕，减少深夜刷购物APP。"
            })

    # 7. 周期性消费
    if recurring:
        top_recurring = [r for r in recurring if r["total"] > 200][:3]
        if top_recurring:
            items = "、".join(f"{r['merchant'][:12]}(¥{r['total']:.0f}/{r['months']}月)" for r in top_recurring)
            recs.append({
                "icon": "🔄", "title": "检测到周期性消费",
                "level": "info",
                "detail": f"以下商户有持续消费记录：{items}。建议检查是否有不必要的订阅或习惯性消费，考虑降低频率或寻找替代方案。",
                "action": "逐一审视这些周期性支出：哪些是「需要」vs「想要」？取消或降级1-2项。"
            })

    # 8. 收入结构
    income_cats = {c["name"]: c["amount"] for c in analysis["categories"]["income"]}
    salary_amt = income_cats.get("💰 工资收入", 0)
    if salary_amt > 0:
        monthly_salary = salary_amt / max(len(monthly_data), 1)
        recs.append({
            "icon": "💼", "title": f"月均工资约 ¥{monthly_salary:,.0f}",
            "level": "good",
            "detail": f"识别到工资类收入，按当前覆盖月份估算月均约 ¥{monthly_salary:,.0f}。该估算会受缺失月份和一次性发放影响。",
            "action": "核对覆盖月份是否完整，并把工资、报销和退款分开观察，避免把一次性入账当作稳定收入。"
        })

    # 9. 大额支出
    if big_expenses:
        top5_big = [e for e in big_expenses if e["amount"] >= 1000][:5]
        if top5_big:
            items = "、".join(f"{e['merchant'][:15]} ¥{e['amount']:.0f}" for e in top5_big)
            recs.append({
                "icon": "🔍", "title": "大额支出审视",
                "level": "info",
                "detail": f"Top 5大额支出：{items}。建议对单笔超过¥1,000的支出建立「24小时冷静期」规则，避免冲动消费。",
                "action": "在手机备忘录建立「大额消费冷静清单」，任何超¥1,000的非必需消费记录后等24小时再决定。"
            })

    # 10. 多渠道管理
    recs.append({
        "icon": "📱", "title": "多渠道支付管理建议",
        "level": "info",
        "detail": "多渠道支付会增加重复记录和漏记风险。定期对账比强制集中到某一种支付工具更重要。",
        "action": "每月固定一次核对各渠道账单，检查重复、退款、自动续费和不再使用的小额免密授权。"
    })

    return recs


# ============================================================
# 主函数
# ============================================================
def sanitize_records(records):
    """清理所有文本字段中的换行符和特殊字符"""
    text_fields = ["merchant", "description", "search_text", "channel", "payment_method"]
    for r in records:
        for f in text_fields:
            if f in r and r[f]:
                r[f] = r[f].replace("\n", " ").replace("\r", "").replace("\t", " ").strip()
                # 截断过长的文本
                if len(r[f]) > 200:
                    r[f] = r[f][:197] + "..."
    return records


def build_argument_parser():
    parser = argparse.ArgumentParser(
        description="兼容版三来源账单分析器；日常使用推荐打开 index.html"
    )
    parser.add_argument("--bank", type=Path, help="银行流水 PDF")
    parser.add_argument("--wechat", type=Path, help="微信支付官方 XLSX")
    parser.add_argument("--alipay", type=Path, help="支付宝官方 CSV")
    parser.add_argument("--pdf-password", help="加密银行 PDF 的打开密码（仅保存在当前进程内存）")
    parser.add_argument(
        "--self-name", action="append", default=[],
        help="本人账户姓名，可重复传入，用于识别内部转账",
    )
    parser.add_argument(
        "--output", type=Path, default=Path("report_complete.html"),
        help="HTML 报告路径，默认 report_complete.html",
    )
    parser.add_argument(
        "--json-output", type=Path,
        help="可选：另存完整分析 JSON；其中包含交易明细，请妥善保管",
    )
    return parser


def main(argv=None):
    parser = build_argument_parser()
    args = parser.parse_args(argv)
    if not any((args.bank, args.wechat, args.alipay)):
        parser.error("请至少提供 --bank、--wechat 或 --alipay 中的一项")

    for path in (args.bank, args.wechat, args.alipay):
        if path and not path.exists():
            parser.error(f"文件不存在：{path}")

    print()
    print("=" * 60)
    print("  钱都去哪了 · 兼容版账单分析引擎")
    print("=" * 60)
    print()

    all_records = []

    if args.bank:
        print("[1/4] 解析银行流水 PDF...")
        bank_data = parse_bank_pdf(args.bank, args.pdf_password)
        all_records.extend(bank_data)
        print(f"      银行卡: {len(bank_data)} 条")

    if args.wechat:
        print("[2/4] 解析微信账单...")
        wechat_data = parse_wechat_xlsx(args.wechat)
        all_records.extend(wechat_data)
        income_count = sum(1 for r in wechat_data if r["direction"] == "income")
        expense_count = sum(1 for r in wechat_data if r["direction"] == "expense")
        neutral_count = sum(1 for r in wechat_data if r["direction"] == "neutral")
        print(f"      微信: {len(wechat_data)} 条 (收入{income_count} 支出{expense_count} 中性{neutral_count})")

    if args.alipay:
        print("[3/4] 解析支付宝账单...")
        alipay_data = parse_alipay_csv(args.alipay)
        all_records.extend(alipay_data)
        income_count = sum(1 for r in alipay_data if r["direction"] == "income")
        expense_count = sum(1 for r in alipay_data if r["direction"] == "expense")
        neutral_count = sum(1 for r in alipay_data if r["direction"] == "neutral")
        print(f"      支付宝: {len(alipay_data)} 条 (收入{income_count} 支出{expense_count} 中性{neutral_count})")

    print(f"      总计: {len(all_records)} 条原始记录")

    # 清理文本
    all_records = sanitize_records(all_records)

    print("[4/4] 统一口径、跨来源去重与分析...")
    analysis = analyze(all_records, self_names=args.self_name)
    analysis["recommendations"] = generate_recommendations(analysis)

    # 输出
    print(f"      有效支出: {analysis['summary']['expense_count']} 笔")
    print(f"      总收入: ¥{analysis['summary']['total_income']:,.2f}")
    print(f"      总支出: ¥{analysis['summary']['total_expense']:,.2f}")
    print(f"      结余: ¥{analysis['summary']['balance']:,.2f}")
    print()

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_output, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        print(f"  数据 JSON 已保存: {args.json_output.resolve()}")

    html = build_html_report(analysis)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  报告已生成: {args.output.resolve()}")
    print()

    return str(args.output.resolve())


# ============================================================
# HTML报告模板
# ============================================================
def build_html_report(data):
    json_data = json.dumps(data, ensure_ascii=False)

    # 预计算所有模板变量
    m = data["meta"]
    s = data["summary"]
    src = data["source_stats"]
    bank_src = src.get("bank", {})
    wechat_src = src.get("wechat", {})
    alipay_src = src.get("alipay", {})
    bank_in = bank_src.get("income", 0)
    bank_ex = bank_src.get("expense", 0)
    wechat_in = wechat_src.get("income", 0)
    wechat_ex = wechat_src.get("expense", 0)
    alipay_in = alipay_src.get("income", 0)
    alipay_ex = alipay_src.get("expense", 0)

    if s["savings_rate"] >= 30:
        rate_label = "✅ 优秀"
    elif s["savings_rate"] >= 10:
        rate_label = "⚡ 可提升"
    else:
        rate_label = "⚠️ 需关注"

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="author" content="tphu">
<title>钱都去哪了 · 个人账单报告</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
<style>
:root {{
  --bg: #0a0e14;
  --bg-card: #12161e;
  --border: #1e2530;
  --text: #c9d1d9;
  --text-dim: #6e7681;
  --accent: #58a6ff;
  --green: #3fb950;
  --red: #f85149;
  --yellow: #d29922;
  --purple: #bc8cff;
  --cyan: #39c5cf;
  --orange: #f0883e;
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Noto Sans SC", sans-serif;
  line-height: 1.6; min-height: 100vh;
}}
.app {{ max-width: 1280px; margin: 0 auto; padding: 24px 20px; }}
.header {{
  text-align: center; padding: 40px 0 32px;
  border-bottom: 1px solid var(--border); margin-bottom: 32px;
}}
.header h1 {{ font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px;
  background: linear-gradient(135deg, var(--accent), var(--purple)); -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; }}
.header .sub {{ color: var(--text-dim); font-size: 15px; }}
.header .badge-row {{ display: flex; justify-content: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }}
.badge {{ font-size: 12px; padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border);
  color: var(--text-dim); }}
.summary-grid {{
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px;
}}
.summary-card {{
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px;
  padding: 22px 20px; transition: transform .15s, box-shadow .15s;
}}
.summary-card:hover {{ transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,0,0,.3); }}
.summary-card .label {{ font-size: 13px; color: var(--text-dim); margin-bottom: 8px; }}
.summary-card .value {{ font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }}
.summary-card .sub {{ font-size: 12px; color: var(--text-dim); margin-top: 4px; }}
.section {{ margin-bottom: 32px; }}
.section-title {{ font-size: 19px; font-weight: 700; margin-bottom: 16px; padding-left: 12px;
  border-left: 3px solid var(--accent); }}
.card {{
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px;
  padding: 24px; margin-bottom: 16px;
}}
.card h3 {{ font-size: 16px; font-weight: 600; margin-bottom: 14px; }}
.chart-row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
.chart-box {{ width: 100%; height: 340px; }}
.table-wrap {{ overflow-x: auto; max-height: 520px; overflow-y: auto; border-radius: 8px; }}
.table-wrap::-webkit-scrollbar {{ width: 5px; height: 5px; }}
.table-wrap::-webkit-scrollbar-track {{ background: var(--bg); }}
.table-wrap::-webkit-scrollbar-thumb {{ background: var(--border); border-radius: 3px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
th {{ position: sticky; top: 0; background: var(--bg-card); color: var(--text-dim); font-weight: 600;
  font-size: 12px; text-transform: uppercase; letter-spacing: .3px; padding: 10px 12px;
  border-bottom: 2px solid var(--border); text-align: left; z-index: 1; }}
td {{ padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }}
tr:hover td {{ background: rgba(255,255,255,0.03); }}
.filter-bar {{ display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }}
.filter-bar select, .filter-bar input {{
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  padding: 8px 14px; border-radius: 8px; font-size: 13px; outline: none;
}}
.filter-bar select:focus, .filter-bar input:focus {{ border-color: var(--accent); }}
.filter-bar input {{ flex: 1; min-width: 180px; }}
.tag {{
  display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 500;
}}
.tag.income {{ background: rgba(63,185,80,0.15); color: var(--green); }}
.tag.expense {{ background: rgba(248,81,73,0.15); color: var(--red); }}
.tag.neutral {{ background: rgba(110,118,129,0.15); color: var(--text-dim); }}
.rec-card {{
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px;
  padding: 22px 24px; margin-bottom: 12px; border-left: 4px solid var(--border);
  transition: transform .1s;
}}
.rec-card:hover {{ transform: translateX(4px); }}
.rec-card.good {{ border-left-color: var(--green); }}
.rec-card.warning {{ border-left-color: var(--orange); }}
.rec-card.info {{ border-left-color: var(--accent); }}
.rec-header {{ display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }}
.rec-header .rec-icon {{ font-size: 24px; }}
.rec-header .rec-title {{ font-weight: 700; font-size: 15px; }}
.rec-detail {{ color: var(--text-dim); font-size: 13px; line-height: 1.7; margin-bottom: 8px; }}
.rec-action {{ font-size: 13px; padding: 8px 14px; background: rgba(88,166,255,0.08);
  border-radius: 8px; border-left: 2px solid var(--accent); }}
.upload-zone {{
  border: 2px dashed var(--border); border-radius: 16px; padding: 36px;
  text-align: center; cursor: pointer; transition: all .2s; margin-bottom: 20px;
}}
.upload-zone:hover, .upload-zone.drag {{ border-color: var(--accent); background: rgba(88,166,255,0.04); }}
.upload-zone input {{ display: none; }}
.upload-zone .icon {{ font-size: 40px; margin-bottom: 10px; }}
.upload-zone .text {{ color: var(--text-dim); font-size: 14px; }}
.upload-status {{ font-size: 12px; color: var(--green); margin-top: 8px; }}
.amount-income {{ color: var(--green); }}
.amount-expense {{ color: var(--red); }}
.amount-neutral {{ color: var(--text-dim); }}
.source-grid {{
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px;
}}
.source-card {{
  padding: 18px; border-radius: 12px; text-align: center;
  border: 1px solid var(--border); background: var(--bg-card);
}}
.source-card .src-name {{ font-weight: 700; margin-bottom: 6px; }}
.source-card .src-stat {{ font-size: 12px; color: var(--text-dim); }}
@media (max-width: 768px) {{
  .summary-grid {{ grid-template-columns: repeat(2, 1fr); }}
  .chart-row {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>钱都去哪了 · 个人账单报告</h1>
    <div class="sub">{m["date_range"]} · 三源合一（银行卡+微信+支付宝）</div>
    <div class="badge-row">
      <span class="badge">🏦 银行卡 {m["bank_records"]}条</span>
      <span class="badge">💬 微信 {m["wechat_records"]}条</span>
      <span class="badge">💙 支付宝 {m["alipay_records"]}条</span>
      <span class="badge">🔄 已去重</span>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">💰 总收入</div>
      <div class="value" style="color:var(--green)">¥{s["total_income"]:,.0f}</div>
      <div class="sub">{s["income_count"]} 笔收入</div>
    </div>
    <div class="summary-card">
      <div class="label">💳 总支出</div>
      <div class="value" style="color:var(--red)">¥{s["total_expense"]:,.0f}</div>
      <div class="sub">{s["expense_count"]} 笔消费</div>
    </div>
    <div class="summary-card">
      <div class="label">📈 结余</div>
      <div class="value" style="color:var(--accent)">¥{s["balance"]:,.0f}</div>
      <div class="sub">日均消费 ¥{s["daily_avg"]:.0f}</div>
    </div>
    <div class="summary-card">
      <div class="label">🎯 结余率</div>
      <div class="value" style="color:var(--yellow)">{s["savings_rate"]}%</div>
      <div class="sub">{rate_label}</div>
    </div>
  </div>

  <div class="source-grid">
    <div class="source-card">
      <div class="src-name">🏦 银行卡</div>
      <div class="src-stat">收入 ¥{bank_in:,.0f}</div>
      <div class="src-stat">支出 ¥{bank_ex:,.0f}</div>
    </div>
    <div class="source-card">
      <div class="src-name">💬 微信支付</div>
      <div class="src-stat">收入 ¥{wechat_in:,.0f}</div>
      <div class="src-stat">支出 ¥{wechat_ex:,.0f}</div>
    </div>
    <div class="source-card">
      <div class="src-name">💙 支付宝</div>
      <div class="src-stat">收入 ¥{alipay_in:,.0f}</div>
      <div class="src-stat">支出 ¥{alipay_ex:,.0f}</div>
    </div>
  </div>

  <!-- 图表区域 -->
  <div class="chart-row">
    <div class="card"><h3>📂 消费分类占比</h3><div id="pieChart" class="chart-box"></div></div>
    <div class="card"><h3>📅 月度收支趋势</h3><div id="barChart" class="chart-box"></div></div>
  </div>
  <div class="chart-row">
    <div class="card"><h3>🏪 消费商户 Top 15</h3><div id="merchantChart" class="chart-box"></div></div>
    <div class="card"><h3>💳 支付方式分布</h3><div id="paymentChart" class="chart-box"></div></div>
  </div>
  <div class="chart-row">
    <div class="card"><h3>📆 星期消费分布</h3><div id="weekdayChart" class="chart-box"></div></div>
    <div class="card"><h3>🕐 时段消费分布</h3><div id="hourChart" class="chart-box"></div></div>
  </div>

  <!-- 大额支出 -->
  <div class="section">
    <div class="section-title">🔍 大额消费明细 (Top 30)</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>金额</th><th>商户</th><th>描述</th><th>分类</th><th>支付方式</th></tr></thead>
          <tbody id="bigTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 建议 -->
  <div class="section">
    <div class="section-title">💡 智能分析与改进建议</div>
    <div id="recContainer"></div>
  </div>

  <!-- 全部交易 -->
  <div class="section">
    <div class="section-title">📋 全部交易记录</div>
    <div class="card">
      <div class="filter-bar">
        <select id="catFilter"><option value="">全部分类</option></select>
        <select id="dirFilter">
          <option value="">全部方向</option>
          <option value="income">收入</option>
          <option value="expense">支出</option>
          <option value="neutral">不计收支</option>
        </select>
        <select id="srcFilter">
          <option value="">全部来源</option>
          <option value="bank">银行卡</option>
          <option value="wechat">微信支付</option>
          <option value="alipay">支付宝</option>
        </select>
        <input type="text" id="searchInput" placeholder="搜索商户、描述...">
        <span id="filterCount" style="color:var(--text-dim);font-size:13px;"></span>
      </div>
      <div class="table-wrap" style="max-height:600px;">
        <table>
          <thead><tr><th>日期</th><th>时间</th><th>方向</th><th>金额</th><th>商户</th><th>描述</th><th>分类</th><th>来源</th></tr></thead>
          <tbody id="txTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 重新上传区域 -->
  <div class="section">
    <div class="section-title">📤 更新账单数据</div>
    <div class="card">
      <p style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">
        上传新的微信/支付宝账单文件，自动重新分析（支持 .xlsx / .csv 格式）
      </p>
      <div class="chart-row">
        <div class="upload-zone" id="wechatUpload">
          <div class="icon">💬</div>
          <div class="text">点击上传微信账单 (.xlsx)</div>
        </div>
        <div class="upload-zone" id="alipayUpload">
          <div class="icon">💙</div>
          <div class="text">点击上传支付宝账单 (.csv)</div>
        </div>
      </div>
      <div id="uploadStatus" class="upload-status"></div>
    </div>
  </div>

  <div style="text-align:center;padding:32px 0;color:var(--text-dim);font-size:12px;border-top:1px solid var(--border);margin-top:20px;">
    钱都去哪了 · by tphu · 数据更新时间 {data["meta"]["generated_at"]}
  </div>
</div>

<script>
const D = {json_data};

// === 渲染辅助 ===
const COLORS = ['#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#39c5cf','#f0883e','#79c0ff','#56d364','#e3b341',
  '#ff7b72','#a5d6ff','#7ee787','#ffa657','#d2a8ff','#f778ba','#fd8c73','#9198a1'];

function fmt(n) {{ return '¥' + Number(n).toLocaleString('zh-CN', {{minimumFractionDigits:0,maximumFractionDigits:0}}); }}
function fmt2(n) {{ return '¥' + Number(n).toLocaleString('zh-CN', {{minimumFractionDigits:2,maximumFractionDigits:2}}); }}

// === 饼图 ===
(function(){{
  const chart = echarts.init(document.getElementById('pieChart'));
  chart.setOption({{
    tooltip: {{trigger:'item', formatter:'{{b}}<br/>{{c}} ({{d}}%)'}},
    legend: {{type:'scroll', orient:'vertical', right:10, top:20, bottom:20, textStyle:{{color:'#6e7681',fontSize:12}}}},
    color: COLORS,
    series:[{{type:'pie', radius:['45%','75%'], center:['35%','50%'],
      itemStyle:{{borderColor:'#12161e',borderWidth:2}},
      label:{{color:'#c9d1d9',fontSize:11}},
      data: D.categories.expense.map(c=>({{name:c.name,value:c.amount}}))
    }}]
  }});
}})();

// === 月度柱状图 ===
(function(){{
  const chart = echarts.init(document.getElementById('barChart'));
  chart.setOption({{
    tooltip: {{trigger:'axis'}},
    legend: {{data:['收入','支出','净额'],textStyle:{{color:'#6e7681'}},top:0}},
    grid: {{left:'3%',right:'4%',bottom:'3%',top:'15%',containLabel:true}},
    xAxis: {{type:'category',data:D.monthly.map(m=>m.month),axisLabel:{{color:'#6e7681'}}}},
    yAxis: {{type:'value',axisLabel:{{color:'#6e7681',formatter:v=>(v/10000).toFixed(1)+'w'}}}},
    series:[
      {{name:'收入',type:'bar',data:D.monthly.map(m=>m.income),itemStyle:{{color:'#3fb950',borderRadius:[4,4,0,0]}}}},
      {{name:'支出',type:'bar',data:D.monthly.map(m=>m.expense),itemStyle:{{color:'#f85149',borderRadius:[4,4,0,0]}}}},
      {{name:'净额',type:'line',data:D.monthly.map(m=>m.net),itemStyle:{{color:'#d29922'}},
        lineStyle:{{width:2}},symbol:'circle',symbolSize:6}}
    ]
  }});
}})();

// === 商户横向柱状图 ===
(function(){{
  const chart = echarts.init(document.getElementById('merchantChart'));
  const data = D.merchants.slice(0,15);
  chart.setOption({{
    tooltip: {{trigger:'axis',formatter:p=>p[0].name+'<br/>'+fmt(p[0].value)}},
    grid: {{left:'3%',right:'12%',bottom:'3%',top:'8%',containLabel:true}},
    xAxis: {{type:'value',axisLabel:{{color:'#6e7681',formatter:v=>(v/1000).toFixed(0)+'k'}}}},
    yAxis: {{type:'category',data:data.map(d=>d.name).reverse(),
      axisLabel:{{color:'#6e7681',fontSize:11,formatter:v=>v.length>12?v.slice(0,11)+'…':v}},
      inverse:true}},
    series:[{{type:'bar',data:data.map(d=>d.amount).reverse(),
      itemStyle:{{color:new echarts.graphic.LinearGradient(0,0,1,0,[
        {{offset:0,color:'#58a6ff'}},{{offset:1,color:'#bc8cff'}}]),
        borderRadius:[0,6,6,0]}}}}]
  }});
}})();

// === 支付方式 ===
(function(){{
  const chart = echarts.init(document.getElementById('paymentChart'));
  chart.setOption({{
    tooltip: {{trigger:'item',formatter:'{{b}}<br/>{{c}} ({{d}}%)'}},
    color: ['#3fb950','#58a6ff','#f0883e','#d29922','#bc8cff'],
    series:[{{type:'pie',radius:['40%','70%'],
      itemStyle:{{borderColor:'#12161e',borderWidth:2}},
      label:{{color:'#c9d1d9',fontSize:12,formatter:'{{b}}\\n{{d}}%'}},
      data: D.payment_methods.map(p=>({{name:p.name,value:p.amount}}))
    }}]
  }});
}})();

// === 星期分布 ===
(function(){{
  const chart = echarts.init(document.getElementById('weekdayChart'));
  chart.setOption({{
    tooltip: {{trigger:'axis'}},
    grid: {{left:'3%',right:'4%',bottom:'3%',top:'8%',containLabel:true}},
    xAxis: {{type:'category',data:D.weekday.map(w=>w.name),axisLabel:{{color:'#6e7681'}}}},
    yAxis: {{type:'value',axisLabel:{{color:'#6e7681',formatter:v=>fmt(v)}}}},
    series:[{{type:'bar',data:D.weekday.map(w=>w.amount),
      itemStyle:{{color:function(p){{
        const c=['#58a6ff','#58a6ff','#58a6ff','#58a6ff','#58a6ff','#f0883e','#f0883e'];
        return c[p.dataIndex]||'#58a6ff';
      }},borderRadius:[6,6,0,0]}}}}]
  }});
}})();

// === 时段分布 ===
(function(){{
  const chart = echarts.init(document.getElementById('hourChart'));
  chart.setOption({{
    tooltip: {{trigger:'axis'}},
    grid: {{left:'3%',right:'4%',bottom:'3%',top:'8%',containLabel:true}},
    xAxis: {{type:'category',data:D.hourly.map(h=>h.hour+'时'),axisLabel:{{color:'#6e7681'}}}},
    yAxis: {{type:'value',axisLabel:{{color:'#6e7681',formatter:v=>fmt(v)}}}},
    series:[{{type:'bar',data:D.hourly.map(h=>h.amount),
      itemStyle:{{color:'#39c5cf',borderRadius:[6,6,0,0]}}}}]
  }});
}})();

// === 大额支出表 ===
(function(){{
  const tbody = document.getElementById('bigTable');
  tbody.innerHTML = D.big_expenses.map((e,i)=>`
    <tr>
      <td>${{e.date}}</td>
      <td class="amount-expense" style="font-weight:600">${{fmt2(e.amount)}}</td>
      <td>${{e.merchant}}</td>
      <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${{e.description}}</td>
      <td>${{e.category}}</td>
      <td style="color:var(--text-dim);font-size:12px">${{e.payment_method}}</td>
    </tr>
  `).join('');
}})();

// === 建议 ===
(function(){{
  const container = document.getElementById('recContainer');
  container.innerHTML = D.recommendations.map(r=>`
    <div class="rec-card ${{r.level}}">
      <div class="rec-header">
        <span class="rec-icon">${{r.icon}}</span>
        <span class="rec-title">${{r.title}}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${{r.level==='good'?'✅ 好':'⚡ 建议'}}</span>
      </div>
      <div class="rec-detail">${{r.detail}}</div>
      <div class="rec-action">📌 行动建议：${{r.action}}</div>
    </div>
  `).join('');
}})();

// === 交易表格 ===
(function(){{
  const txTable = document.getElementById('txTable');
  const catFilter = document.getElementById('catFilter');
  const dirFilter = document.getElementById('dirFilter');
  const srcFilter = document.getElementById('srcFilter');
  const searchInput = document.getElementById('searchInput');
  const filterCount = document.getElementById('filterCount');

  const categories = [...new Set(D.transactions.map(t=>t.category))];
  catFilter.innerHTML = '<option value="">全部分类</option>'+categories.map(c=>`<option value="${{c}}">${{c}}</option>`).join('');

  function render(){{
    const cat = catFilter.value, dir = dirFilter.value, src = srcFilter.value;
    const q = searchInput.value.toLowerCase();
    const filtered = D.transactions.filter(t=>{{
      if(cat && t.category!==cat) return false;
      if(dir && t.direction!==dir) return false;
      if(src && t.source!==src) return false;
      if(q && !`${{t.merchant}} ${{t.description}} ${{t.payment_method}}`.toLowerCase().includes(q)) return false;
      return true;
    }});
    filterCount.textContent = `共 ${{filtered.length}} 条`;
    txTable.innerHTML = filtered.slice(0,500).map(t=>{{
      const dirLabel = t.direction==='income'?'收入':t.direction==='neutral'?'不计':'支出';
      const cls = t.direction==='income'?'amount-income':t.direction==='neutral'?'amount-neutral':'amount-expense';
      const sign = t.direction==='income'?'+':'-';
      const srcIcon = t.source==='bank'?'🏦':t.source==='wechat'?'💬':'💙';
      return `<tr>
        <td>${{t.date}}</td><td style="color:var(--text-dim)">${{t.time||''}}</td>
        <td><span class="tag ${{t.direction}}">${{dirLabel}}</span></td>
        <td class="${{cls}}" style="font-weight:600">${{sign}}${{fmt2(t.amount)}}</td>
        <td>${{t.merchant}}</td>
        <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${{t.description}}</td>
        <td>${{t.category}}</td>
        <td style="color:var(--text-dim)">${{srcIcon}}</td>
      </tr>`;
    }}).join('') || '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-dim)">没有匹配记录</td></tr>';
  }}

  catFilter.addEventListener('change',render);
  dirFilter.addEventListener('change',render);
  srcFilter.addEventListener('change',render);
  searchInput.addEventListener('input',render);
  render();
}})();

// === 文件上传功能 ===
(function(){{
  function setupUpload(zoneId, label, parser) {{
    const zone = document.getElementById(zoneId);
    if(!zone) return;
    const status = document.getElementById('uploadStatus');

    zone.addEventListener('click',()=>{{
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = zoneId==='wechatUpload'?'.xlsx,.xls':'.csv';
      input.onchange = e => {{
        const file = e.target.files[0];
        if(!file) return;
        status.textContent = `正在解析 ${{file.name}}...`;
        const reader = new FileReader();
        reader.onload = function(ev) {{
          try {{
            if(zoneId==='wechatUpload'){{
              const wb = XLSX.read(ev.target.result, {{type:'array'}});
              const sheet = wb.Sheets[wb.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json(sheet, {{header:1, defval:''}});
              status.textContent = `${{label}}：解析到 ${{rows.length}} 行，请刷新页面查看完整报告（浏览器端仅预览，完整分析需运行Python引擎）`;
              console.log('WeChat data:', rows.slice(0,10));
            }} else {{
              const text = new TextDecoder('gbk').decode(new Uint8Array(ev.target.result));
              const parsed = Papa.parse(text, {{header:false}});
              status.textContent = `${{label}}：解析到 ${{parsed.data.length}} 行，请刷新页面查看完整报告（浏览器端仅预览，完整分析需运行Python引擎）`;
              console.log('Alipay data:', parsed.data.slice(0,10));
            }}
          }} catch(err) {{
            status.textContent = `解析失败：${{err.message}}`;
          }}
        }};
        if(zoneId==='wechatUpload') reader.readAsArrayBuffer(file);
        else reader.readAsArrayBuffer(file);
      }};
      input.click();
    }});
  }}
  setupUpload('wechatUpload', '微信账单');
  setupUpload('alipayUpload', '支付宝账单');
}})();

window.addEventListener('resize',()=>location.reload());
</script>
</body>
</html>'''


if __name__ == "__main__":
    main()
