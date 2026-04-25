# QDII Dashboard v2

纯静态前端版本，面向 GitHub Pages 部署。

## 运行

```bash
cd v2
npm run serve
```

默认访问地址：

```text
http://127.0.0.1:3000
```

## 部署到 GitHub Pages

仓库根目录已经提供自动部署工作流：

- [deploy-v2-pages.yml](/Users/11164010/Documents/FIRE/海外/.github/workflows/deploy-v2-pages.yml)

部署步骤：

1. 在 GitHub 上新建一个仓库，把当前目录推到 `main` 分支。
2. 进入仓库 `Settings -> Pages`。
3. 在 `Build and deployment` 里把 `Source` 设为 `GitHub Actions`。
4. 推送 `main` 分支后，GitHub Actions 会自动把 `v2/` 目录部署到 Pages。
5. 部署完成后，访问：

```text
https://<你的 GitHub 用户名>.github.io/<仓库名>/
```

说明：

- 工作流只会发布 `v2/`，不会把旧版 `public/` 和 `worker/` 一起发到 Pages。
- `v2` 已经使用相对路径、相对 `scope` 和相对 `start_url`，可以直接部署在仓库子目录站点下。
- 如需手机安装为桌面应用，首次打开后可在手机浏览器里“添加到主屏幕”。

## 核心变化

- 行情改为前端直连东方财富 JSONP
- 本地存储改为 IndexedDB
- 新增历史事件日志与每日净值导出
- 新增 GitHub Gist 加密备份与恢复
- 新增收益曲线 tab，支持 TWR / XIRR 统计和多种时间区间、资产粒度筛选
- 新增“生成演示历史 / 恢复原历史”，便于预览收益曲线效果
- 资源路径改为相对路径，便于 GitHub Pages 子目录部署
