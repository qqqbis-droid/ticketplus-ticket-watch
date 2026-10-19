# iPhone 設定 Telegram 自建推播（無須提供我任何密碼）

1. 安裝並登入 Telegram。
2. 進入官方 [@BotFather](https://t.me/BotFather)，傳 `/newbot`，依指示輸入顯示名稱與結尾為 `bot` 的帳號名稱。
3. BotFather 會給你一段 **Bot Token**。**不要貼到 ChatGPT、公開 GitHub 頁面、Issue、程式碼、錄影或截圖。**
4. 在 Telegram 搜尋你新建立的機器人，點 `Start`（/start），讓它有權傳訊息給你。
5. 取得私人聊天的數字 Chat ID：例如 Telegram 的 [@userinfobot](https://t.me/userinfobot) 回覆的 `Id`。這是第三方機器人；不想使用可透過自己的 Bot API `getUpdates` 私下取得，但請注意不要公開 Bot Token。私人對話情境通常以你的 Telegram 數字 User ID 作為 Chat ID。
6. iPhone Safari 開啟 [專案 GitHub Actions Secrets](https://github.com/qqqbis-droid/ticketplus-ticket-watch/settings/secrets/actions)。選 `New repository secret` 並分別新增：
   - `TELEGRAM_BOT_TOKEN`：剛剛 BotFather 給的金鑰
   - `TELEGRAM_CHAT_ID`：第 5 步的數字 ID
   GitHub 可能需要在 iPhone Safari 按網站「要求桌面版網站」才能完整看到按鈕。
7. 打開 [Telegram iPhone test notification](https://github.com/qqqbis-droid/ticketplus-ticket-watch/actions/workflows/telegram-test.yml) → `Run workflow` → `Run workflow`。
8. 進去查看 Action 成功狀態，Telegram 應出現「**🧪 測試通知**」。**這不是有票通知。**

## 安全與狀態

- Telegram Bot 私聊通知一般可免費使用。
- 只有你能從 iPhone 設定金鑰，我無法替你讀取，也不需要你傳給我。
- 主監測 GitHub Actions 的 `schedule` 已移除。Ticket Plus 活動資料公開請求在 GitHub runner 實測 HTTP 403；六場真實售票狀態尚未驗證，暫時 **不得啟用正式監票**。
- 驗證前絕不要設定 `MONITOR_ENABLED=true` 或 `PUBLIC_ACTIVITY_VERIFIED=true`。
