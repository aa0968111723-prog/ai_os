# Assistant Brain v2 狀態

## 已在本 PR 建立

- [x] GoalFrame typed contract
- [x] Active Goal typed contract
- [x] Source / desired outcome / continuation typed enums
- [x] `goalRequiresVerifiedExecution` guard
- [x] remote evidence scope guard
- [x] conservative continuation hint（只作 hint，不具執行權）
- [x] 基礎 unit tests
- [x] 完整修復契約與驗收矩陣

## 仍需在本 PR 完成後才能離開 Draft

- [ ] Global Assistant main-orchestrator routing
- [ ] 修正 NIM silent default / provider telemetry
- [ ] Working Project Resolver
- [ ] semantic Goal resolver
- [ ] active goal persistence / resume integration
- [ ] Capability Registry → executable action surface 收斂
- [ ] Drive/File/Folder waiting semantics
- [ ] false completion 全面清除
- [ ] recent typed result referent execution
- [ ] source provenance query / evidence formatter
- [ ] capability unavailable honest fallback
- [ ] mobile + desktop golden E2E
- [ ] full validation green

此 PR 在上述項目完成前保持 Draft，不得以文件完成視為產品修復完成。
