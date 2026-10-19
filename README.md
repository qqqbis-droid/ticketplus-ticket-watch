# Ticket Plus 六場次搶票雷達（安全測試版）

**目前未啟用正式監測或 Telegram；Ticket Plus 的購票狀態尚未經實站驗證。**

這個儲存庫獨立於股票雷達，僅進行一般網頁讀取，不登入、不繞過驗證、不搶購或下單。

## 場次
六個 2026 年日期：12/12、12/13、12/15、12/18、12/19、12/20，網址在 config/events.json。

## 第一步：在 GitHub 執行安全觀察
1. 打開本儲存庫 Actions → Ticket Plus safe monitor → Run workflow。
2. 選擇 mode = probe，再執行。這不會推播、不會修改票況狀態。
3. 打開執行結果下方 Artifacts，下載 ticketplus-probe。
4. 查看 probe.json、六張頁面截圖。確認是否為正常售票頁、是否可看到票種／價格／售完按鈕。如果只看到 JavaScript 提示、空白、驗證碼或禁止存取，不要啟用正式監測。
5. 如果實站可讀，需依頁面實際 DOM 填寫 config/verified_rules.json 內六場的 button_css、button_text_regex、context_text_regex。只要缺一場，正式模式拒絕啟動。

## 第二步：設定 Telegram（只在驗證成功後）
- iPhone 安裝 Telegram，打開 https://t.me/BotFather，輸入 /newbot，建立自己的 Bot。
- 開啟剛剛建立的 Bot，按 Start 或傳送 /start。
- 使用自己 iPhone 的 Safari 造訪 Telegram getUpdates 介面，讀取 message.chat.id。**Bot token 和 chat ID 不要傳給 ChatGPT、不放入公開儲存庫**。
- 在 GitHub Settings → Secrets and variables → Actions → Repository secrets 設定 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID。
- 在同頁 Variables 設定 MONITOR_ENABLED=true 及 SITE_VERIFIED=true；只有六場全部確認能讀到可用購票控制項後才能開啟。
- 手動 Actions → Run workflow → monitor，確認收到真實測試結果並可防止重複通知。

## 安全與限制
- 排程預定每五分鐘一輪（GitHub Actions 可能延遲、漏跑）。
- 未驗證、網頁錯誤、人機驗證、缺少票種按鈕均不會冒充有票。
- 免費公開儲存庫的程式與網址公開，**絕不可把 Telegram token 放進程式**。
- 2026-12-21 00:00（台北時間）後程式停止執行檢查；GitHub Actions 的 cron 設定仍須自行停用。
- 不保證第三方網站對自動監控的接受度。應尊重其網站使用規範。
- 執行本機測試：python -m unittest discover -s tests -v
