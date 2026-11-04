> 该项目需配合NewAPI才能正常使用：[https://github.com/Calcium-Ion/new-api](https://github.com/Calcium-Ion/new-api)

<div align="center">

<h1 align="center">Neko API Key Tool</h1>

NewAPI 令牌查询页

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCalcium-Ion%2Fneko-api-key-tool&env=REACT_APP_SHOW_DETAIL&env=REACT_APP_SHOW_BALANCE&env=REACT_APP_BASE_URL&env=REACT_APP_SHOW_ICONGITHUB&project-name=neko-api-key-tool&repository-name=neko-api-key-tool)

</div>

![image](img.png)


### 使用方法

#### Vercel 部署
1. 准备好你的 [NewAPI项目](https://github.com/Calcium-Ion/new-api);
2. 点击右侧按钮开始部署：
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCalcium-Ion%2Fneko-api-key-tool&env=REACT_APP_SHOW_DETAIL&env=REACT_APP_SHOW_BALANCE&env=REACT_APP_BASE_URL&env=REACT_APP_SHOW_ICONGITHUB&project-name=neko-api-key-tool&repository-name=neko-api-key-tool)，直接使用 Github 账号登录即可，记得根据自己需求配置环境变量，环境变量如下： 

```   
REACT_APP_SHOW_BALANCE: 是否展示令牌信息，true 或 false
REACT_APP_SHOW_DETAIL: 是否展示调用详情，true 或 false
REACT_APP_BASE_URL: 你的NewAPI项目地址
REACT_APP_SHOW_ICONGITHUB: 是否展示Github图标，true 或 false
```

例如如下配置：
```
# 展示令牌信息
REACT_APP_SHOW_BALANCE=true

# 展示调用详情
REACT_APP_SHOW_DETAIL=true

# NewAPI的BaseURL（支持多个NewAPI站点聚合查询，键值对中的键为站点名称，值为站点的URL）
REACT_APP_BASE_URL={"server1": "https://nekoapi.com", "server2": "https://gf.nekoapi.com"}

# 展示GitHub图标
REACT_APP_SHOW_ICONGITHUB=true
```

3. 部署完毕后，即可开始使用；
4. （可选）[绑定自定义域名](https://vercel.com/docs/concepts/projects/domains/add-a-domain)：Vercel 分配的域名 DNS 在某些区域被污染了，绑定自定义域名即可直连。

#### Docker 部署

当前 Docker Hub 镜像：

```text
pushchair7463/neko-api-key-tool:latest
```

Docker 镜像启动时会读取容器环境变量并生成运行时配置，因此同一个镜像可以在不同环境中通过 `.env` 配置不同的 NewAPI 地址和显示选项，不需要为不同配置重新构建镜像。

1. 准备环境变量文件：

```bash
cp .env.example .env
vim .env
```

`.env` 示例：

```env
REACT_APP_SHOW_DETAIL=true
REACT_APP_SHOW_BALANCE=true
REACT_APP_BASE_URL={"server1": "https://nekoapi.com", "server2": "https://gf.nekoapi.com"}
REACT_APP_SHOW_ICONGITHUB=true
```

2. 使用 Docker Compose 运行：

```yaml
version: '3.8'

services:
  neko-api-key-tool:
    image: pushchair7463/neko-api-key-tool:latest
    container_name: neko-api-key-tool
    ports:
      - "80:80"
    env_file:
      - .env
    restart: unless-stopped
```

3. 启动或更新容器：

```bash
docker compose pull
docker compose up -d
```

也可以直接使用 `docker run`：

```bash
docker run -d -p 80:80 --name neko-api-key-tool --env-file .env pushchair7463/neko-api-key-tool:latest
```

如果你使用 1Panel / OpenResty / Nginx 反向代理，并且容器加入了外部 Docker 网络，可以不直接暴露端口，例如：

```yaml
version: '3.8'

services:
  neko-api-key-tool:
    image: pushchair7463/neko-api-key-tool:latest
    container_name: neko-api-key-tool
    env_file:
      - .env
    restart: unless-stopped
    networks:
      ai-api:
        ipv4_address: 10.0.1.4

networks:
  ai-api:
    external: true
```

此时反向代理目标可以配置为：

```text
http://10.0.1.4:80
```

如果外部网络不存在，可以先创建：

```bash
docker network create ai-api
```

### 二次开发
复制 `.env.example` 文件为 `.env`，根据自己需求配置 `.env` 文件中的环境变量。
