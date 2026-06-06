# 万能导入 V2 - 智能多格式批量下单系统

WMS仓储管理系统，支持通过大模型智能解析 Excel/Word/PDF 等格式的出库单文件，实现批量下单。

## 技术栈

- **框架**: Next.js 14 App Router + TypeScript
- **样式**: Tailwind CSS（鲸天系统风格，主色 #0fc6c2）
- **AI**: DeepSeek / OpenAI 兼容 API
- **数据库**: Neon Serverless PostgreSQL
- **部署**: Vercel

## 核心功能

1. **多格式文件导入** - 支持 Excel (.xlsx/.xls)、Word (.docx)、PDF
2. **AI 辅助规则生成** - 大模型自动分析文件结构并生成解析规则
3. **规则引擎** - 通用解析规则体系，不硬编码特定文件
4. **数据预览编辑** - 类Excel表格，实时校验，在线编辑
5. **批量下单提交** - 数据持久化到数据库
6. **运单列表管理** - 搜索筛选分页查看历史记录

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填入数据库URL和AI API Key

# 启动开发服务器
npm run dev
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Neon PostgreSQL 连接串 |
| `AI_API_URL` | AI API 地址 (默认 DeepSeek) |
| `AI_API_KEY` | AI API Key |
| `AI_MODEL` | AI 模型名称 (默认 deepseek-chat) |

## 部署到 Vercel

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 通过 Vercel Marketplace 集成 Neon 数据库
4. 设置环境变量
5. 部署

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── ai/generate-rule/  # AI 生成规则
│   │   ├── orders/submit/     # 提交下单
│   │   ├── orders/            # 运单列表
│   │   ├── parse/preview/     # 文件预览
│   │   ├── parse/             # 文件解析
│   │   └── rules/             # 规则CRUD
│   ├── rules/page.tsx         # 规则管理页
│   ├── orders/page.tsx        # 运单列表页
│   ├── page.tsx               # 导入下单主页
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── NavBar.tsx
│   ├── FileUploader.tsx
│   ├── RuleSelector.tsx
│   ├── RuleEditor.tsx
│   ├── DataTable.tsx
│   └── ProgressBar.tsx
└── lib/
    ├── types.ts               # 类型定义
    ├── db.ts                  # 数据库操作
    ├── rule-engine.ts         # 规则引擎
    └── ai-service.ts          # AI服务
```
