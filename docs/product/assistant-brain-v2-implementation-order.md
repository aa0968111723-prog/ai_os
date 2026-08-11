# Assistant Brain v2 實作順序

1. 修 false completion：所有 picker / clarification / approval 都不得標 completed。
2. Working Project Resolver：不再只靠 page projectId；接 recent result / active goal / unique candidate / HITL。
3. Orchestrator model routing：主理解層不得 silent default 到 NIM；明確記 provider/model/fallback。
4. GoalFrame + active goal：new / continue / correct / confirm / pending answer。
5. Source grounding + evidence scope：remote source、imported provenance、library、project usage 分離。
6. Capability matcher：直接由 Capability Registry 導出可執行面，收斂 duplicate site-action catalog。
7. Execution semantics：需要 action 的 desired outcome 必須 real tool + verification 才 completed。
8. Recent typed result：讓「這些 / 剛才那批 / 這一版」直接成為下一個 tool input。
9. Honest capability gap：Google Photos remote listing 等做不到就說明，不 silent substitute。
10. E2E：Drive 無 page context、cloud count、Photos correction、recent assets organize/attach。

每一步都先補 regression test，再改 implementation；不得用大量新 regex 代替 semantic resolver。
