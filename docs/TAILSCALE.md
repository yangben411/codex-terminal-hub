# Tailscale 部署、代理共存与优化

本指南记录本项目的本地部署方式及可复用排障流程。核对日期：2026-10-04。域名、设备名、IP、账号均使用占位符；不要把 Tailscale 状态文件、认证密钥、完整代理订阅或未脱敏诊断输出上传 GitHub。

## 1. 本机已核对的配置

| 项目 | 核对结果 |
| --- | --- |
| 客户端 | macOS App，Tailscale 1.102.4；这是核对版本，不是项目最低版本要求 |
| CLI | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` |
| 服务 | HTTPS Serve，标记为 `tailnet only`，根路径代理至 `http://127.0.0.1:7681` |
| DNS / 出口 | MagicDNS 已启用；本机未使用 Exit Node |
| 系统代理 | HTTP、HTTPS、SOCKS 指向本机 `127.0.0.1:7890` |
| 代理例外 | 当时系统例外包含 localhost 和常见私网段，但未列出 tailnet 域名及 `100.64.0.0/10`；仅凭此不能断定访问失败原因 |
| 网络快照 | UDP 可用，IPv4 可用，IPv6 未连通，`MappingVariesByDestIP: false` |
| 活跃链路 | 核对时一个活跃 peer 有直接连接地址；不代表所有设备和网络始终直连 |
| DERP 探测 | 当时最低探测值约 160 ms；这是 DERP 探测耗时，不是网页/session 延迟 |

没有在本次文档整理中部署中继或更改网络配置。以前使用的代理 YAML 不在原路径，未验证其现行规则。下面的代理和中继设置是可选方案，不是本机配置导出。

## 2. 安装与启用私有访问

在主机、另一台 Mac、手机上安装 Tailscale，登录允许访问主机的 tailnet 并保持连接。macOS 按系统提示批准网络扩展；不要同时安装多个客户端变体。参阅 [macOS 安装说明](https://tailscale.com/docs/install/mac)。

在运行 Hub 的 Mac 上执行：

```sh
# 本终端中的便捷函数，不修改系统 PATH
ts() { /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"; }

curl -I http://127.0.0.1:7681/
ts serve --bg http://127.0.0.1:7681
ts serve status
```

若提示 `Serve is not enabled`，打开命令打印的启用链接，用具备相应权限的账号完成配置后重试。此时 Ctrl+C 后的 `context canceled` 是取消等待，不代表 Hub 崩溃。

访问 `serve status` 返回的完整 HTTPS 地址，例如 `https://YOUR-HOST.YOUR-TAILNET.ts.net/`。不要在手机上打开 `127.0.0.1:7681`（那是手机自身），也不要用 `https://100.x.x.x` 代替证书域名。Serve 的工作方式见 [官方命令参考](https://tailscale.com/docs/reference/tailscale-cli/serve)。

安全要求：

- Hub 保持监听 `127.0.0.1`，不需要路由器映射 7681。
- 本项目没有应用账号密码，访问权限等同于主机用户的终端权限。
- 在 tailnet 策略中将主机 TCP 443 限制给自己的可信设备；检查已有宽泛放行规则，不要仅追加限制规则后就以为完成隔离。
- 不要启用 Funnel、不要公开反向代理这个终端。

## 3. 重启后如何恢复

`serve --bg` 会持久保留设置，在 Tailscale 重新运行后恢复 Serve；它不负责启动 Hub，也不负责恢复已经丢失的 tmux 进程。参阅 [Serve 的重启行为](https://tailscale.com/docs/reference/tailscale-cli/serve#effects-of-rebooting-and-restarting)。

分别检查三层：

1. Tailscale 客户端随登录启动、账号连接正常。
2. Hub 按 README 安装用户 LaunchAgent（`npm run service:install`）；用户服务依赖登录环境，不能保证 FileVault 解锁前可用。
3. 重启后运行 `curl -I http://127.0.0.1:7681/` 和 `ts serve status`。macOS 重启会终止原 tmux 会话；不要把“网页服务恢复”理解为“原 CLI 进程恢复”。

Mac 睡眠、网络切换、设备密钥过期也会影响可访问性。按实际需求配置电源和登录策略，不要通过禁用全部安全措施来追求常在线。

## 4. Safari / Clash / Mihomo 共存

“手机能开，Mac 不能开”先在出问题的 Mac 排查。`curl` 和 Safari 的代理路径可能不同，HTTP 200 只证明那次请求成功，不证明浏览器 WebSocket 也成功。

```sh
scutil --proxy
curl -Iv --noproxy '*' https://YOUR-HOST.YOUR-TAILNET.ts.net/
dscacheutil -q host -a name YOUR-HOST.YOUR-TAILNET.ts.net
```

`--noproxy '*'` 排除 curl 的显式代理，不会绕过 TUN、VPN 或底层网络过滤器。不要加 `-k` 掩盖证书问题。

### 4.1 系统代理与规则

在代理客户端的“绕过/不代理”设置中加入实际 Hub 域名或自己的 tailnet 后缀；保留已有例外。客户端可能覆盖 macOS 系统代理设置，因此优先在其持久配置中修改。TUN 模式还需要检查路由/DNS 接管，不能只改系统代理例外。

下面是 Mihomo 的规则片段，合并到现有 `rules` 前部、广泛代理规则和最终 `MATCH` 之前；不要产生第二个 `rules:` 或覆盖整份配置。替换 `YOUR-TAILNET`：

```yaml
rules:
  - DOMAIN-SUFFIX,YOUR-TAILNET.ts.net,DIRECT
  - IP-CIDR,100.100.100.100/32,DIRECT,no-resolve
  - IP-CIDR,100.64.0.0/10,DIRECT,no-resolve
  # 原有规则继续放在这里
```

`100.64.0.0/10` 是共享地址范围，不全部属于你的设备；存在运营商/企业地址冲突时，可仅为需要的 Tailscale 设备添加 `/32` 规则。上述规则不授权访问，只影响代理路由。语法见 [Mihomo 路由规则](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/rules/index.en.md)。

### 4.2 DNS / fake-IP

如果代理接管 DNS 并返回 fake-IP，可针对自己的 tailnet 设置排除和 DNS 分流。以下仅适用于 `fake-ip-filter-mode: blacklist`，须合并已有列表和映射；使用其他模式时按对应语法调整：

```yaml
dns:
  fake-ip-filter-mode: blacklist
  fake-ip-filter:
    - '+.YOUR-TAILNET.ts.net'
  nameserver-policy:
    '+.YOUR-TAILNET.ts.net': '100.100.100.100'
```

前提是本机已连接 Tailscale，并能访问其 DNS 地址。不要把所有公网 DNS 查询都改送到这个地址。若配置了 `direct-nameserver`，还应按客户端文档检查是否遵循 `nameserver-policy`。参阅 [Mihomo DNS 配置](https://wiki.metacubex.one/en/config/dns/)。

先备份、校验配置，再重载；每次只改一层。规则只覆盖业务 tailnet 域名，不要求把全部 `tailscale.com` 控制面流量强制直连——在某些网络里这样反而会导致登录或协调连接失败。

## 5. 先测量，再优化速度

在访问端执行（Mac 上先定义前面的 `ts` 函数）：

```sh
ts status
ts ping YOUR-HOST
ts netcheck
```

同时在主机运行 `ts netcheck` 对比。测试应包含实际使用网络：家中 Wi-Fi、手机蜂窝、外部 Wi-Fi。保存时间和网络类型，不要把未经脱敏的完整输出上传。

| 结果 | 下一步 |
| --- | --- |
| `direct` / ping 到直接地址 | 已直连；继续检查丢包、Wi-Fi、主机负载和浏览器渲染，而非盲目增加中继 |
| `relay` / DERP | 检查两端 UDP、NAT、防火墙及代理/TUN 干扰，再评估中继 |
| `peer-relay` | 已经经同 tailnet 的中继设备转发；对比该路径稳定性和耗时 |
| HTTP 成功但终端不能用 | 查 `/api/terminal-stream` WebSocket 是否为 101、是否持续连接以及 session 状态 |

连接类型和诊断原则见 [Tailscale 连接类型](https://tailscale.com/docs/reference/connection-types)及 [防火墙说明](https://tailscale.com/docs/reference/faq/firewall-ports)。DERP 字段存在不等于当前数据必经 DERP；首次 ping 经中继也不代表后续无法转直连。

网页的 session RTT、`tailscale ping`、`netcheck` 的 DERP 延迟测量对象不同，不能直接等同。终端断开时应按连接状态排障，不能用残留的延迟数字判断可输入。

优化顺序：先修正代理/DNS 路径，再检查 UDP/网络条件，最后才评估中继。不要为了“加速”关闭整个防火墙、开放 Hub 公网端口或随意调 MTU。

## 6. 自建中继：可选，不是本机已部署

不能直连时，可评估 Tailscale Peer Relay 或自定义 DERP。中继节点的地理位置不是唯一指标，应测两端到它的实际路径；更贵的服务器也不保证更快。

Peer Relay 使用 tailnet 内设备转发，需要满足客户端版本、可达 UDP 端口和 relay capability 策略要求；不能只运行一个启动命令就认为已经生效。具体安装、授权、验证和停用按 [Peer Relay 官方指南](https://tailscale.com/docs/features/peer-relay)操作。本项目不附全员放行策略，避免把个人终端权限扩大给整个 tailnet。

自定义 DERP 是另一条路线，需要维护服务、TLS、端口及 tailnet DERP 映射。参考 [DERP 说明](https://tailscale.com/docs/reference/derp-servers)和 [官方实现](https://github.com/tailscale/tailscale/blob/main/derp/README.md)。部署后重新测量实际连接，不要仅凭节点出现在列表就认定提速；未验证前保留可用回退路径。

## 7. 验收清单

- 主机本地 HTTP 正常，Serve 指向正确端口且为 `tailnet only`。
- 手机关闭 Wi-Fi 后仍可通过 HTTPS 域名访问；另一台 Mac/Safari 也可访问。
- WebSocket 持续连接，能查看输出、发送无害命令并收到回应。
- 切换网络后可恢复；跨浏览器接管按 Hub 的 Reconnect 机制操作。
- 分别确认 Tailscale 和 Hub 的启动配置；未实际重启前不要宣称通过重启验收。
- 本项目的历史缓存、渲染流控参数见 [配置参考](CONFIGURATION.md)，不是 Tailscale 网络加速参数。
