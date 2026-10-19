# Ticket Plus 六場次搶票雷達（安全測試版）

**目前未啟用正式監測或 Telegram；Ticket Plus 的購票狀態尚未經實站驗證。**

這個儲存庫獨立於股票雷達，僅進行一般網頁讀取，不登入、不繞過驗證、不搶購或下單。

## 場次
六個 2026 年日期：12/12、12/13、12/15、12/18、12/19、12/20，網址在 config/events.json。

## 2026-10-19 實站測試結果（請先閱讀）

GitHub Actions 已使用真實 Chrome 瀏覽器訪問六個 /order/ 連結（測試執行 https://github.com/qqqbis-droid/ticketplus-ticket-watch/actions/runs/39275634692）。
**所有六場都跳轉到 /activity/af2bd66d8fe65d78963cbb5bdc85771c，並顯示手機號碼／密碼登入視窗；沒有看到個別場次的票種與庫存。**
畫面上的「立即購買」是活動首頁按鈕，不能解讀為有票。程式已新增登入轉址識別（login_required）；即使出現一般活動購買按鈕，仍不得發送通知。

補充測試：直接訪問公開 /activity/ 頁（測試紀錄 https://github.com/qqqbis-droid/ticketplus-ticket-watch/actions/runs/39276416002），畫面僅顯示 Loading...、2024 年占位日期，未能取得 2026 年六場票況。這也無法作為有效監票資料來源。

**正式監測與 Telegram 仍然停用。** 此免費、未登入雲端方案目前無法可靠判斷何時釋票，不應依賴它搶票。
請勿在公開 GitHub、Issues 或對話提供 Ticket Plus 的密碼／驗證碼／登入 Cookie。
若將來 Ticket Plus 提供公開票況頁或官方通知／合法授權查詢方式，再重新驗證後啟用監測。

## 2026-10-20 iPhone 登入後畫面核對

使用者提供的 Safari 螢幕錄影，實際進入 2026/12/12 田馥甄小巨蛋演唱會之 /order/ 分區選票頁。畫面中的各區逐列呈現 `剩餘 0`；展開 NT$800 的黃3G區則顯示 `已售完`。

**監測規則已改進：** 只有同一個經獨立實站驗證的票區控制項可互動，且該票區文字顯示 `剩餘 N` 且 N > 0 時，才能判定 `available`。若只見「剩餘 > 0」而無法驗證可操作票區，僅判定候選，不發推播；當前可見票區全為 0 也不能推論整個活動所有票區售罄。

**登入仍是阻礙：** 使用者 iPhone Safari 的登入狀態無法提供給 GitHub Actions；不得要求使用者提供密碼、驗證碼、session cookies 或登入 token。GitHub 雲端未經授權進入票種頁前，正式監測仍保持停用。

## 2026-10-20 監測方案暫停與替代選項

已移除 GitHub Actions 的五分鐘 `schedule`，只保留手動 `workflow_dispatch` 測試模式。原因：GitHub 執行器無法共用 iPhone Safari 上的 Ticket Plus 會員登入狀態，六場並未取得可驗證的即時票況。不能把無效的 Cron 當成有效監測。

可嘗試第三方「票探 monitixx」(https://www.monitixx.com/) 的免費見習探員方案：網站宣稱支援 Ticket Plus、免費 1 個活動與 1 台裝置的重新開票推播。尚未獨立驗證田馥甄本次演出的六場是否全數已收錄或實際通知速度；請用 Safari 註冊並確認活動/場次可選，再加入主畫面及開啟 Web Push。第三方服務與 Ticket Plus 官方無關，無須提供 Ticket Plus 密碼。

## 2026-10-20 監控方式改為「活動首頁場次狀態」

使用者指定公開活動首頁：https://ticketplus.com.tw/activity/af2bd66d8fe65d78963cbb5bdc85771c

已新增 `src/public_activity.py`，其邏輯**不是**登入六個 /order/ 頁，也不是依據票區剩餘張數。它只會辨識活動首頁列表裡**符合六場 2026 年日期的那一列**：

- 狀態欄為「已售完」「銷售一空」→ 當作沒有開賣。
- 同一列的售票狀態變成可見、可操作的藍色「立即購買／立即購票」→ 可判定該場可能開放購票；才有資格推播。
- 網站上方固定的「立即購買」、2024 年預設內容、Loading…、日期缺失／重複、登入／錯誤頁都不得當成有票。
- 只有成功發出 Telegram 訊息後才記錄已通知；售完再重新開放會再次通知。所有判斷需要網站真實 DOM 驗證。

**尚未啟用每五分鐘監控，也尚未設定 Telegram。** 目前 GitHub Actions 只提供手動 probe；請在 Actions 開啟「Ticket Plus activity page watcher (not yet activated)」→ Run workflow → mode = probe，結果產生 public-activity-status artifact。若網頁仍為 Loading… 或讀不到六場，絕不可開啟 MONITOR_ENABLED／PUBLIC_ACTIVITY_VERIFIED。

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
