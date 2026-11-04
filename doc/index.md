# neko-api-key-tool

NewAPI 令牌查询工具，用于查询 API Key 的使用额度与详情。

## 项目信息
- **类型**：纯前端项目（React）
- **状态**：维护修复阶段
- **原始项目**：https://github.com/Calcium-Ion/neko-api-key-tool

## 技术栈
- React 18.2.0 + react-scripts 5.0.1
- Semi UI + Semantic UI
- axios

## 核心功能
- 根据 API Key 查询使用额度
- 展示令牌余额与调用详情
- 支持多 NewAPI 站点聚合查询

## 环境变量
| 变量 | 说明 |
|------|------|
| REACT_APP_SHOW_DETAIL | 展示调用详情 (true/false) |
| REACT_APP_SHOW_BALANCE | 展示余额 (true/false) |
| REACT_APP_BASE_URL | NewAPI 站点地址 |
| REACT_APP_SHOW_ICONGITHUB | 展示 GitHub 图标 (true/false) |