# GitHub Pages 部署说明

## 交付包里已经准备好的内容

- GitHub Actions 工作流：
  [deploy-v2-pages.yml](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/.github/workflows/deploy-v2-pages.yml)
- 要发布的静态站点目录：
  [v2](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/v2)

这个工作流只会发布 `v2/` 目录。

## 为什么可以直接发到 Pages

`v2` 已经做了这些适配：

- 静态资源全部走相对路径
- `manifest.webmanifest` 的 `start_url` 和 `scope` 都是相对路径
- 目录里有 `.nojekyll`，避免 Pages 按 Jekyll 规则改写静态文件
- service worker 版本号已经固定在当前可用版本

## 标准部署步骤

1. 把当前交付包内容推到 GitHub 仓库根目录
2. 打开仓库 `Settings -> Pages`
3. 把 `Source` 设为 `GitHub Actions`
4. 打开仓库 `Actions`
5. 等 `Deploy v2 to GitHub Pages` 工作流执行完成
6. 打开工作流页面给出的站点地址

## 如果工作流没有自动运行

先检查这几项：

- 代码是不是推到了 `main` 分支
- 仓库根目录下是否真的有 `.github/workflows/deploy-v2-pages.yml`
- 仓库里是否真的有 `v2/`
- `Settings -> Pages` 里是否已经选了 `GitHub Actions`
- 仓库是否禁用了 GitHub Actions

## 如果站点打开是 404

优先检查：

- 仓库是不是刚部署完，还没完全生效
- Pages 的来源是不是已经切到 `GitHub Actions`
- 访问地址是不是：

```text
https://<你的 GitHub 用户名>.github.io/<仓库名>/
```

## 如果页面还是旧版本

这个项目启用了 service worker，碰到旧缓存时按这个顺序试：

1. 浏览器强制刷新
2. 完全关闭页面再重开
3. 如果是手机主屏幕图标启动，先退出再重开
4. 还不行就清理该站点缓存或删掉主屏幕图标后重新打开

## 手机上怎么用

1. 用手机浏览器打开 Pages 地址
2. 输入口令解锁
3. 先确认一次刷新结果正常
4. 再“添加到主屏幕”

## 官方参考

- GitHub Pages 自定义工作流：
  [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- GitHub Pages 发布源配置：
  [Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
