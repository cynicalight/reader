# Reader Local Working Preferences

## Small UI validation

非常小、局部且低风险的 UI 调整不运行完整的 `pnpm test` 或 `pnpm build`。这类改动包括间距、颜色、对齐、控件位置、文案、图标，以及删除纯展示信息。

按实际改动执行最小验证：优先运行直接相关的测试；修改 TypeScript 时运行 `pnpm typecheck`；纯 CSS 或静态文案调整可只做差异检查和必要的人工验收说明。

当改动扩展到应用行为、数据持久化、生命周期、解析器、Provider 协议、跨模块接口、依赖、构建或发布配置时，再运行相应的完整检查。只有用户明确要求时，才为上述小型 UI 调整额外运行完整测试或完整构建。
