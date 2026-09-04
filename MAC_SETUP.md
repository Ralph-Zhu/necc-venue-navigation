# 在 MacBook 上继续开发

## 第一次下载

1. 安装 GitHub Desktop，并登录与 Windows 相同的 GitHub 账号。
2. 选择 **File → Clone Repository**。
3. 选择私有仓库 `necc-venue-navigation`。
4. 选择 Mac 上的保存目录并完成 Clone。
5. 在 Codex 中把克隆后的文件夹添加为项目。

## 启动地图

在项目目录打开终端，任选一种方式：

```bash
node tools/static-server.js
```

或者使用 macOS 自带的 Python：

```bash
python3 -m http.server 8765
```

浏览器打开：

```text
http://127.0.0.1:8765/campus-all.html
```

## 在新的 Codex 任务中继续

把克隆后的 `venue-editor-demo` 目录设为工作项目。Codex 会读取根目录的 `AGENTS.md`。新任务可以直接使用下面的提示：

```text
继续国家会展中心多层3D导航项目。先阅读 AGENTS.md、MODEL_GENERATION_STANDARD_V2_DRAFT.md 和当前 git 状态，不要破坏已确认的模型比例、楼层变换、设施尺寸与导航规则。先运行现有版本并报告当前基线，再进行我接下来提出的修改。
```

## 每次开始工作

在 GitHub Desktop 中先点击：

```text
Fetch origin → Pull origin
```

确认 Windows 上最后一次修改已经同步下来，再开始编辑。

## 每次结束工作

1. 在 GitHub Desktop 左下角填写本次修改摘要；
2. 点击 **Commit to main**；
3. 点击 **Push origin**；
4. 等待 Push 完成后再关闭电脑。

第二天回到 Windows，同样先执行 `Fetch origin → Pull origin`。

## 避免冲突

- 不要让 Windows 和 Mac 同时修改同一项目；
- 每台电脑开始前先 Pull，结束后必须 Push；
- 如果 GitHub Desktop 显示冲突，不要随意选择覆盖，先让 Codex检查差异；
- Figma 负责维护 SVG 源图，导出后放入 `assets` 并和代码一起提交。

