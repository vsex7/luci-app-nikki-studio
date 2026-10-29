# luci-app-nikki-studio

为 [Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki)（OpenWrt 上的 Mihomo 透明代理）提供的**可视化配置编辑器**。
不用再手写 YAML：在 LuCI 里添加自建节点、创建策略组、编写分流规则、管理规则集，保存前自动校验，启动失败自动回滚。

> 独立插件，不修改 Nikki / luci-app-nikki 的任何文件，可随时卸载。

## 功能

| 页面 | 能做什么 |
| --- | --- |
| 概览 | Nikki 运行状态、配置来源、环境检查（混入文件是否启用、LuCI 规则冲突、其他代理插件冲突、内核模块），一键开启混入文件 |
| 节点 | 粘贴分享链接导入（ss / vmess / vless 含 Reality / trojan / hysteria2(hy2) / tuic / anytls / socks5 / http）、Base64 订阅内容、WireGuard 配置文件、Clash YAML；手动编辑；排序；延迟测试 |
| 策略组 | 表单式新建/编辑（select / url-test / fallback / load-balance / relay），有序成员选择，按关键字筛选订阅节点并实时预览命中节点，常用地区筛选预设，复制订阅中的策略组再修改 |
| 规则 | 分页表格、搜索、拖动排序、常用预设（AI 服务、OpenCode、GitHub、Telegram、流媒体、广告拦截、国内直连…）、批量导入、**规则测试**（输入域名看命中哪条）、生效顺序预览 |
| 规则集 | rule-providers 管理（http / file / inline），MetaCubeX meta-rules-dat 预设（可选 jsDelivr 镜像），添加时可同时生成 RULE-SET 规则，改名自动同步引用 |
| 备份与恢复 | 每次保存/恢复前自动备份（每个文件保留 30 份，系统升级保留），查看与当前文件的差异，一键恢复 |

顶部工具栏：**重新加载 / 校验 / 查看差异 / 保存 / 保存并重启**。

## 工作方式

默认编辑 **`/etc/nikki/mixin.yaml`（混入文件）**，不碰订阅：

- 「追加」列表写入 `nikki-proxies` / `nikki-proxy-groups` / `nikki-rules`，Nikki 启动时插在订阅内容**前面**；
- 「替换」列表写入 `proxies` / `proxy-groups` / `rules`，整体替换订阅中的对应部分；
- `rule-providers` 与订阅中的规则集合并。

订阅更新不会覆盖这些修改。也可以在顶部把编辑目标切换为 `/etc/nikki/profiles/` 下的某个配置文件直接修改（订阅文件会被自动更新覆盖，因此不能作为编辑目标）。

**校验**会在路由器上完整模拟 Nikki 的启动流程：读取当前订阅/配置 → 应用 Nikki 的覆盖选项 → 合并 mixin.yaml → 执行 Nikki 自己的 `mixin.uc` → 后处理 → Nikki 启动检查（DNS / 透明代理端口 / TUN）→ 引用关系检查（策略组成员、规则目标、规则集是否存在、循环引用等，中文提示）→ `mihomo -t` 内核校验。

**保存并重启**：校验通过 → 备份 → 原子写入 → 重启 Nikki → 检查启动日志、进程和 API；若 90 秒内未正常启动，自动恢复保存前的版本并再次重启，失败的版本另存为备份供排查。

只有被修改的部分会被重写，文件中其他内容（包括 dns、sniffer 等以及它们的注释）保持不变。

## 要求

- OpenWrt **25.12 或更高版本**（apk 包管理）
- 已安装 `nikki`（建议同时安装 `luci-app-nikki`）
- 依赖会自动安装：`luci-base yq curl ucode ucode-mod-fs ucode-mod-uci`
- 在 Nikki 插件中开启「混入配置 → 混入文件」（概览页可一键开启）

## 安装

```sh
# 上传 apk 到路由器后
apk add --allow-untrusted ./luci-app-nikki-studio-1.0.0-r1.apk
```

刷新 LuCI，菜单位于「服务 → Nikki Studio」。

卸载：`apk del luci-app-nikki-studio`（备份目录 `/etc/nikki-studio/` 会保留，可手动删除）。

## 典型用法：给 OpenCode 单独分流

1. 「节点」→ 导入分享链接，粘贴自建 VPS 的 `vless://…` 链接；
2. 「策略组」→ 新建 `🧑‍💻 OpenCode`，类型 url-test，成员选刚导入的节点（或勾选「包含全部节点」+ 筛选 `(?i)港|HK`）；
3. 「规则」→ 常用预设勾选「OpenCode」并指向 `🧑‍💻 OpenCode`，用「规则测试」输入 `api.opencode.ai` 确认命中；
4. 点「校验」，通过后「保存并重启」。

## 已知限制

- **编辑过的部分**中的 YAML 注释、锚点会在保存时丢失（锚点会被展开）；锚点被文件其他位置引用的部分只能查看。未编辑的部分不受影响。
- 订阅若设置为「优先远程」，Nikki 启动时会重新下载订阅，最终结果可能与校验时不同（会有提示）。
- Nikki 插件中开启「混入配置 → 规则」时，它会覆盖混入文件中的 `nikki-rules`，此时校验会拒绝保存追加规则（请二选一）。
- 规则测试在浏览器本地模拟，GEOSITE / GEOIP / RULE-SET 等依赖数据库的规则无法判断，会单独列出。
- 策略组筛选预览不包含 proxy-providers（节点订阅）中的节点。
- 延迟测试需要 Nikki 正在运行并配置了 external-controller，且只对已保存生效的节点有效。
- 界面仅提供中文。

## 从源码构建

```sh
# 在 OpenWrt 25.12 SDK 中
git clone <本仓库> package/luci-app-nikki-studio
./scripts/feeds update luci && ./scripts/feeds install luci-base
make defconfig
make package/luci-app-nikki-studio/compile V=s
# 若 SDK 无法编译 luci-base 的依赖，可直接构建本包（纯脚本，与架构无关）：
make -C package/luci-app-nikki-studio TOPDIR=$PWD compile
```

## 目录结构

```
htdocs/luci-static/resources/
  tools/nikkistudio.js          共享 UI：rpc、会话（工作副本）、工具栏、任务轮询、对话框、差异
  tools/nikkistudio_parse.js    纯函数：规则解析、分享链接/WireGuard 解析、筛选预览、YAML 输出、行差异
  view/nikki-studio/*.js        六个页面
root/usr/share/rpcd/ucode/luci.nikki-studio   rpcd ucode 接口（ubus 对象 luci.nikki-studio）
root/usr/share/nikki-studio/lib.uc            核心逻辑：读取/生成候选配置、模拟合并、校验、备份、锁
root/usr/libexec/nikki-studio/job.uc          后台任务：校验 / 保存 / 恢复 / 重启健康检查 / 自动回滚
root/usr/share/rpcd/acl.d/, root/usr/share/luci/menu.d/, root/etc/uci-defaults/
tests/                                        node 单元测试、YAML 往返测试
```

## 许可

GPL-3.0-or-later
