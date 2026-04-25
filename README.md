# QDII Dashboard v2 交付包

这个目录是给另一台电脑直接接手用的最小发布包。

它已经包含：

- `v2/`：资产统计工具 v2.0 的静态站点代码
- `.github/workflows/deploy-v2-pages.yml`：GitHub Pages 自动部署工作流
- `01-quick-start.md`：最短迁移路径
- `02-github-pages-deploy.md`：Pages 配置与排错
- `03-gist-setup.md`：GitHub Gist 备份与恢复说明

当前交付包包含这些较新的能力：

- 收益曲线 tab，支持组合 / 资产大类 / 分组 / 单资产视角
- 时间加权收益率曲线和年化收益率 `XIRR`
- 配置页里的“生成演示历史 / 恢复原历史”，便于没有历史数据时先预览曲线效果

建议你把整个目录原样拷走，不要只拿其中一部分。

## 目录用途

这个目录本身就可以当成一个新的 GitHub 仓库根目录使用。

也就是说，到了另一台电脑后：

1. 进入这个目录
2. 直接在这里初始化 Git 仓库，或把这里面的内容上传到 GitHub 仓库根目录
3. 不需要再回到当前老仓库找文件

## 重要提醒

- 上传到 GitHub 时，要上传“这个目录里的内容”，不要把外层目录再套一层
- 不要把 GitHub Token 写进仓库、文档、截图或聊天记录
- Gist Token 建议只保留 `gist` 权限
- 上线后第一次最好同时保留一份“导出密文备份”本地文件，作为第二条备份链路

## 推荐阅读顺序

1. [01-quick-start.md](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/01-quick-start.md)
2. [02-github-pages-deploy.md](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/02-github-pages-deploy.md)
3. [03-gist-setup.md](/Users/11164010/Documents/FIRE/海外/handoff/qdii-dashboard-v2-package/03-gist-setup.md)
