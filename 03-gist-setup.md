# GitHub Gist 配置说明

## 这套 v2 里 Gist 是干什么的

Gist 里保存的是加密后的备份，不是明文持仓。

它主要解决两件事：

- 多设备之间同步密文备份
- 浏览器本地数据丢了以后，从云端恢复

## Token 用哪一种

结合当前 GitHub 文档和这套 v2 的实现，最稳妥的做法是：

- 使用 `Personal access token (classic)`
- 只勾选 `gist` 权限

原因是这套 v2 的 Gist 接入就是按“最小 classic gist token”设计和验证的。  
GitHub 现在整体更推荐 fine-grained token，这一点我这里是基于 GitHub 当前文档和 v2 实测给出的实现建议。

## 如何创建 Token

在 GitHub 网页里大致按这个路径走：

1. 右上角头像
2. `Settings`
3. `Developer settings`
4. `Personal access tokens`
5. `Tokens (classic)`
6. `Generate new token (classic)`
7. 只勾选 `gist`
8. 生成后立刻复制并保存到密码管理器

注意：

- Token 只会完整显示一次
- 不要把 Token 提交进 Git 仓库
- 不要把 Token 写进说明文档、截图或聊天记录

## 在 v2 里做首次 Gist 备份

上线后，在页面里这样操作：

1. 打开配置管理页
2. 在 `GitHub Gist` 输入框里填入 Token
3. 点击 `验证`
4. `Gist ID` 先留空
5. 正常解锁
6. 点击 `立即备份`

首次备份成功后：

- 页面会自动生成并保存 `Gist ID`
- 页面会出现“打开当前 Gist”链接

建议你把这两个东西另外记一份：

- Gist ID
- Token 存放位置

## 新设备怎么从 Gist 恢复

如果新设备本地还没有任何数据，建议按这个顺序：

1. 打开站点
2. 在配置管理页先填入 `Token`
3. 再填入 `Gist ID`
4. 输入原来的口令并解锁

如果当前浏览器本地没有 vault，v2 会在解锁时尝试从 Gist 读取密文备份。

如果你已经先导入了本地密文备份，或者只是想强制拉取云端最新副本，也可以：

1. 先解锁
2. 填好 `Token` 和 `Gist ID`
3. 点击 `从 Gist 恢复`

## 建议的备份习惯

推荐同时保留两条备份链路：

1. Gist 云端密文备份
2. 本地“导出密文备份”文件

这样即使：

- Gist Token 失效
- 浏览器缓存被清空
- 某次手误覆盖了本地数据

你都还有第二条恢复路径。

## 如果以后要更换 Token

步骤很简单：

1. 在 GitHub 撤销旧 Token
2. 新建一个新的 classic token，只保留 `gist`
3. 回到站点重新填入新 Token
4. 保留原来的 `Gist ID`
5. 点一次 `验证`
6. 再点一次 `立即备份`

## 常见问题

### 1. 验证失败

优先检查：

- Token 是否复制完整
- 是否真的只给了 `gist` 或至少包含 `gist`
- GitHub 账号是否正常可用

### 2. 能备份但换设备恢复不到

优先检查：

- `Gist ID` 有没有填对
- 是否用了原来的口令
- 新设备是不是先填了 Token 和 Gist ID，再解锁

### 3. 我担心把数据放到 GitHub

这套 v2 保存到 Gist 的是加密密文，不是持仓明文。  
真正决定能不能读出内容的是你的口令，所以口令本身要单独保管。

## 官方参考

- Personal access token 管理：
  [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- Gist REST API：
  [REST API endpoints for gists](https://docs.github.com/en/rest/gists/gists)
