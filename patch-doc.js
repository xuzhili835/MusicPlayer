// 向设计文档插入「熔断降级」与「单点故障分析」两章，并重排编号
const fs = require('fs');
let doc = fs.readFileSync('课设微服务详细设计文档.md', 'utf8');

const newChapters = `## 12. 熔断降级设计

### 12.1 组件选型：Sentinel

与 Nacos 同属 Spring Cloud Alibaba 生态（版本配套无冲突），注解式接入 + 独立控制台（好演示、可动态调规则）；Hystrix 已进维护模式不选。

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```
```yaml
spring.cloud.sentinel:
  transport: { dashboard: "sentinel:8858", port: "8719" }
feign.sentinel.enabled: true   # Feign 调用自动纳入熔断
```
compose 追加：`sentinel: { image: bladex/sentinel-dashboard, ports: ["8858:8858"] }`（账号 sentinel/sentinel）。

### 12.2 熔断点分析（哪些调用需要保护）

| 调用链 | 风险 | 保护方式 |
|---|---|---|
| Mod_media →Feign→ Mod_music/Mod_msg | 对方宕机/慢 → 任务卡死 | Sentinel 熔断 + fallback |
| Gateway → 各业务服务 | 单服务故障拖垮入口线程 | 网关超时 + 熔断（Hystrix/超时配置） |
| Mod_media → 外部站点（B站/GitHub/HF） | 412风控/网络抖动 → 任务连续失败 | **自实现站点级断路器**（Sentinel 管不了外部 HTTP 之外的业务语义） |
| POST /media/download 提交口 | 恶意刷接口堆任务 | Sentinel 限流（QPS） |

### 12.3 降级策略（按语义分层，不是一刀切）

| 类型 | 策略 |
|---|---|
| 查询类（音乐详情/榜单） | Redis 缓存兜底（热门数据 TTL 10min）→ 缓存也没有则返回降级响应 "数据暂时不可用" |
| 写入类（Feign 建库失败） | 任务不失败——status 回 PENDING，@Scheduled 每 30s 重试 3 次，仍失败才 FAILED |
| 消息通知失败 | 仅记日志（通知永远不阻塞主流程） |
| 外部站点熔断 | 连续 5 次任务失败(412/超时) → 该站点断路器 OPEN（快速失败 10min）→ 半开放 1 个探测任务 → 成功则 CLOSE。状态存内存 + 指标 media_site_breaker{site,state} |

```java
// Feign fallback 示例（domain 模块统一提供）
@FeignClient(name = "musicService8002", fallback = MusicClientFallback.class)
public interface MusicClient {
    @PostMapping("/music/internal/create")
    Mess create(@RequestBody Music music);
}
@Component
public class MusicClientFallback implements MusicClient {
    public Mess create(Music music) {
        return Mess.fail().mess("音乐服务暂不可用，任务稍后自动重试");  // 由任务层转 PENDING 重试
    }
}
```

### 12.4 Sentinel 规则（控制台动态配置，课设演示点）

| 资源 | 规则 |
|---|---|
| /media/download | QPS 限流 2/s（单用户 1/s，基于网关透传的 id 头） |
| Feign:musicService8002 | 异常比例 >50%（统计窗口 10s）→ 熔断 30s，最小请求 5 |
| Feign:msgService8006 | 慢调用比例（RT>1s 占 60%）→ 熔断 60s |
| /music/**（网关侧） | QPS 200/s 总闸 |

---

## 13. 单点故障分析（SPOF）与高可用对策

### 13.1 组件级分析表

| 组件 | 单点风险 | 故障影响 | 课设对策 | 生产演进 |
|---|---|---|---|---|
| **MySQL** | ★★★ 唯一状态库 | 全部业务不可用 | 卷持久化 + **每日 mysqldump 定时备份**（compose 备份容器/计划任务，保留7份）+ restart:always | 主从复制 + MHA |
| **Redis** | ★★ 缓存/验证码 | 登录验证码失效、热门查询变慢 | **降级直查 DB**（代码里 Redis 异常 catch 走库）+ restart:always | 哨兵/集群 |
| **Nacos** | ★★ 注册中心 | **已运行服务间调用不受影响**（客户端缓存服务列表）；新实例无法注册、网关发现不到新服务 | standalone + derby 数据目录挂卷持久化 + restart:always | 3节点集群（内置Raft） |
| **Gateway** | ★★★ 唯一入口 | 全部外部流量中断 | restart:always + 多实例说明（不同端口，前置 Nginx 轮询） | LB + 多实例 |
| **Mod_media Worker** | ★★ 任务执行器 | 下载/转写中断 | **任务表自愈（见13.2）** + restart:always | 多实例抢锁执行（DB乐观锁认领任务） |
| **存储卷 /data** | ★★ 文件唯一副本 | 音乐/封面/歌词丢失 | 定期 robocopy/zip 备份到宿主另一目录 | NAS/对象存储 |
| **外部站点（B站/GitHub/HF）** | 不可控 | 下载/更新失败 | §12.3 站点断路器 + 镜像源 + 明确错误提示 | 同左 |
| **邮件服务** | 不可控 | 告警收不到 | 通知异步化不阻塞主流程；可加钉钉 Webhook 双通道 | 同左 |

### 13.2 任务自愈机制（Mod_media 重启恢复）★

media_task 落库是任务可靠性的根基——**进程可死，任务状态不丢**：

```
服务启动时 (@PostConstruct 或 ApplicationRunner):
① 遗留 RUNNING（服务崩溃时进程被杀）:
   单实例部署 → UPDATE media_task SET status='FAILED',
     error='服务重启导致任务中断，请重新提交' WHERE status='RUNNING'
   （多实例演进：RUNNING 带 worker 标识 + 心跳时间，超时才判定死亡）
② 遗留 PENDING（还没轮到执行）:
   保留 PENDING，Worker 启动后自然消费——无需人工干预
③ 清理孤儿临时文件: 扫描 /data/task/*_temp* 删除（进程死了没人清）
④ 工具自检(§4.1) → 通过后 Worker 才开始接任务
```

### 13.3 编排层高可用（compose 强化）

```yaml
# 所有服务统一：
  restart: always

# 基础设施健康检查 + 启动顺序依赖（替代 sleep，更可靠）：
  mysql:
    healthcheck: { test: ["CMD","mysqladmin","ping","-h","localhost"], interval: 10s, retries: 10 }
  redis:
    healthcheck: { test: ["CMD","redis-cli","ping"], interval: 10s, retries: 10 }
  nacos:
    healthcheck: { test: ["CMD-SHELL","curl -f http://localhost:8848/nacos || exit 1"], interval: 15s, retries: 10 }
  mod-media:
    depends_on:
      mysql:  { condition: service_healthy }
      redis:  { condition: service_healthy }
      nacos:  { condition: service_healthy }
```

### 13.4 故障演练场景（答辩演示脚本）

| 演练 | 操作 | 预期 |
|---|---|---|
| 业务服务宕机 | `docker stop mod-music` | 下载任务入库失败 → 自动 PENDING 重试；恢复后自动完成 |
| 熔断触发 | Sentinel 控制台把 musicService 异常比例调低制造失败 | 熔断事件 + fallback 生效 + Grafana 可见 |
| 断电级重启 | `docker compose restart` | 任务自愈执行、PENDING 续跑、临时文件清理 |
| MySQL 恢复 | 停库 → 起库 | 服务自动重连（Druid 重连），备份文件演示 |
| 工具损坏 | 删除容器内 yt-dlp | tool_alive 告警 → 管理接口重装 |

---

## 14. 监控告警`;

// 原 12 监控告警 改为 14（保留内容），并顺延后续编号
doc = doc.replace('## 12. 监控告警', newChapters);
doc = doc.replace('## 13. 容器化部署', '## 15. 容器化部署');
doc = doc.replace('## 14. 非功能与规范', '## 16. 非功能与规范');
doc = doc.replace('## 15. 开发阶段', '## 17. 开发阶段');
doc = doc.replace('## 16. 必带的前车之鉴', '## 18. 必带的前车之鉴');

// 12.x 子节号修正（原监控的 12.1-12.3 变 14.x）
doc = doc.replace('### 12.1 数据流', '### 14.1 数据流');
doc = doc.replace('### 12.2 业务指标', '### 14.2 业务指标');
doc = doc.replace('### 12.3 告警规则', '### 14.3 告警规则');

// 章节内部引用修正
doc = doc.replace('sys_setting.alert_email_to 收件（复用 Commons-Email）', 'sys_setting.alert_email_to 收件（复用 Commons-Email）');

// 开发阶段表补 P5 熔断/高可用
doc = doc.replace('| P5 | Prometheus/Grafana/Alertmanager + 自定义指标 + 看板 + 告警联调 |',
                  '| P5 | Prometheus/Grafana/Alertmanager + 自定义指标 + 看板 + 告警联调 |\n| P6 | Sentinel 熔断限流 + 任务自愈 + 故障演练 |');

fs.writeFileSync('课设微服务详细设计文档.md', doc, 'utf8');
console.log('插入完成');
