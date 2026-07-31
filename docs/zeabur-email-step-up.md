# Zeabur Email + 敏感操作信箱驗證（方案 B）

## 環境變數（Zeabur 服務 Variables → Redeploy）

| 變數 | 說明 |
|------|------|
| `EMAIL_FROM` | 已驗證網域寄件人，例：`AI Director OS <noreply@你的網域>` |
| `ZEABUR_EMAIL_API_KEY` | Zeabur Email API Key（Send Only） |
| `EMAIL_PROVIDER` | 可選：`auto`（預設）／`zeabur`／`resend` |
| `RESEND_API_KEY` | 可選備援 |

驗證：團隊管理 →「寄測試信到我的信箱」。

## 方案 B

- **一般登入**：Email + 密碼（不需驗證碼）
- **變更密碼**：信箱就緒時需 6 位驗證碼
- 信箱未設定：不強制驗證碼，避免鎖死管理員

## Zeabur 步驟

1. 啟用 Zeabur Email
2. 驗證寄件網域（SPF／DKIM）
3. 建立 Send Only API Key
4. 填入 Variables 並 Redeploy
