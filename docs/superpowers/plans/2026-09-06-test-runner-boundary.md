# 测试入口边界修复计划

1. 新增 scripts/test-runner-boundary.test.mjs，按实际 node:test import 盘点文件并检查配置与注册，记录 RED。
2. vite.config.ts 仅排除 native-deployment/native-runtime-config/provider-compat/cutover-source-inventory 四程序。
3. 运行回归与全量 Vitest、lint/build；Node 测试实现未变，保留本轮 17 程序通过证据。
4. 独立审查排除不会漏跑，更新回执、提交推送并核对本次 SHA 云端结果。
