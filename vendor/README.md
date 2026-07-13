# 本地第三方依赖

「钱都去哪了」在运行时只加载本目录中的固定版本文件，不从 CDN 获取或执行脚本。

| 文件 | 来源版本 | 许可证 | 用途 |
|---|---:|---|---|
| `echarts.min.js` | Apache ECharts 6.1.0 | Apache-2.0 | 图表 |
| `papaparse.min.js` | Papa Parse 5.5.4 | MIT | 标准 CSV 解析 |
| `xlsx.full.min.js` | SheetJS CE 0.20.3 | Apache-2.0 | 微信 XLSX 解析 |
| `pdf.min.mjs` / `pdf.worker.min.mjs` | PDF.js 6.1.200 | Apache-2.0 | 银行 PDF 解析 |
| `pdf.bundle.min.js` | 由 PDF.js 6.1.200 使用 esbuild 0.28.0 生成 | Apache-2.0 | 兼容无构建的经典脚本入口 |

许可证全文位于 `vendor/licenses/`。

品牌图标来自 Simple Icons 16.25.0（CC0-1.0）：

- `assets/brands/alipay.svg`：源条目 `alipay`，品牌色 `#1677FF`；
- `assets/brands/wechatpay.svg`：源条目 `wechat`，品牌色 `#07C160`。项目文件名用于表达“微信支付账单来源”，Simple Icons 并不存在独立 `wechatpay` 条目。

品牌名称与图形可能受各自商标规范约束。本项目只用于清晰标识用户导入的账单来源，不表示品牌方赞助或背书。

## 完整性摘要

```text
b66b25aeb4df84e33199dc21694014d336d222cbd9deb0e5a7c14bd6aa0d0fd0  echarts.min.js
ac889c7a0c70f5bdec910e93c519daad741c2cf12ee3017737e4d5d1b768a14d  papaparse.min.js
cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41  xlsx.full.min.js
4ba2f15599b03fde8755ad91349920c21dadd3e8fd6b6460a7663d46d4cf21b5  pdf.min.mjs
2ab9e09667296dab1a618868b3ce6e6c23d5b8f48120ae7c5b34e7e335ed01fa  pdf.worker.min.mjs
d13b62fdf59fa936f144bdfbc44ac2ab9be494edc5f5d4db196663044d133646  pdf.bundle.min.js
132c6ea12c4eff484434a25aaf3676cab1bba444ee0d60da2da353b906e48f46  ../assets/brands/alipay.svg
439de170dff232935f08357fbfb852bb302545d6125861ed6074fe6237b3f912  ../assets/brands/wechatpay.svg
```
