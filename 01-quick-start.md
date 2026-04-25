# 换机快速开始

这份文档只讲最短路径。

## 你需要准备

- 一个 GitHub 账号
- 一台能访问 GitHub 的新电脑
- 这整个 `qdii-dashboard-v2-package` 目录

## 最短上线步骤

1. 在 GitHub 上创建一个新的空仓库。
2. 把当前目录里的全部内容放到仓库根目录。
3. 打开仓库的 `Settings -> Pages`。
4. 在 `Build and deployment` 中把 `Source` 设为 `GitHub Actions`。
5. 等待 Actions 跑完。
6. 用手机打开 Pages 地址，先解锁，再测试一次刷新。

## 方式 A：在新电脑上用 Git 命令推送

假设你已经把这个目录拷到新电脑：

```bash
cd /path/to/qdii-dashboard-v2-package
git init
git branch -M main
git add .
git commit -m "Initial GitHub Pages package for QDII Dashboard v2"
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

推送完成后，再去 GitHub 页面打开 `Settings -> Pages`，把 `Source` 设成 `GitHub Actions`。

## 方式 B：不用命令行，直接网页上传

如果新电脑上暂时不想用 Git 命令，也可以：

1. 在 GitHub 新建空仓库
2. 用网页上传文件功能，把当前目录里的内容全部上传到仓库根目录
3. 确认仓库里能看到：
   - `.github/workflows/deploy-v2-pages.yml`
   - `v2/index.html`
4. 去 `Settings -> Pages` 把 `Source` 改成 `GitHub Actions`

## 部署成功后地址长什么样

通常是：

```text
https://<你的 GitHub 用户名>.github.io/<仓库名>/
```

如果你的仓库名本身就是 `<用户名>.github.io`，那通常会直接挂在根路径。

## 上线后第一轮检查

1. 页面能打开
2. 输入口令能解锁
3. 点“刷新”能拿到行情
4. `511130`、`003156`、`968052` 这些你已经核对过的基金，结果仍然对
5. 收益曲线 tab 能打开
6. 如果暂时还没有历史数据，可先在“配置管理”里点一次“生成演示历史”看曲线效果
7. GitHub Gist 备份能验证通过

后续详细说明见：

- [02-github-pages-deploy.md](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/02-github-pages-deploy.md)
- [03-gist-setup.md](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/03-gist-setup.md)
