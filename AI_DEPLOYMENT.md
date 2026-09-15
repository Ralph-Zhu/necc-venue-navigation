# AI 观展助手部署说明

## 本机配置

1. 复制 `.env.example` 为 `.env`（仓库已提供一个空白 `.env`）。
2. 只在 `.env` 的 `DEEPSEEK_API_KEY=` 后填写真实密钥。
3. 不要在 HTML、JavaScript、截图、聊天或 Git 提交中粘贴密钥。

```env
DEEPSEEK_API_KEY=sk-你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
PORT=8765
```

## 启动

要求 Node.js 20 或更高版本。项目没有外部 npm 依赖。

```powershell
node server/index.js
```

浏览器打开：

```text
http://127.0.0.1:8765/campus-all.html
```

健康检查：

```text
http://127.0.0.1:8765/api/health
```

其中 `aiConfigured: true` 表示服务端成功读取到了密钥。接口不会返回密钥内容。

## 当前数据边界

- 当前只接入 `assets/booths-1.1.json` 中的 66 个模拟展商。
- AI 只能从服务端提供的候选展商中推荐。
- 所有返回的 `boothId` 都会由服务端再次校验。
- 没有配置密钥或上游调用失败时，自动降级为本地关键词匹配，不影响地图和导航。
- 当前不是官网采集版本，后续需独立增加展商资料补全与审核流程。

## 上线前最低要求

- HTTPS 与正式域名。
- 使用进程守护（PM2、systemd 或容器）。
- Nginx/Caddy 反向代理。
- 将 `.env` 只保存在服务器，不上传 GitHub。
- 增加日志脱敏、监控、请求限额与费用告警。
- 将模拟展商替换为主办方审核过的当前届展商数据。
