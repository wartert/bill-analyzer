# Contributing

## 数据安全

只使用合成或完全脱敏的测试数据。不要提交 PDF、CSV、XLS/XLSX、真实商户、姓名、账号、地址、密码或带交易明细的报告。

## 修改流程

1. 为新行为先写会失败的测试；
2. 做最小实现并运行 `npm test`；
3. 运行 `npm run build` 与 `npm run build:offline`；
4. 修改解析、分类或财务口径时，更新相应测试和 README 说明；
5. 不引入运行时 CDN、远程字体或网络请求；所有依赖必须可离线构建并附带许可证信息。

## 本地检查

```bash
npm test
npm run build
npm run build:offline
```

如果改动页面，请同时检查 375、768、1024、1440px，以及浅色、深色和减少动态效果设置。
