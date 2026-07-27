print below exactly

• Mermaid 圖示範 (Diagram Examples)

    1️⃣ 簡單版 (Simple) — 基本流程

    mermaid
    flowchart LR
    A["使用者輸入 (Input)"] -->|"送出 (Submit)"| B["驗證 (Validate)"]
    B -->|"通過 (Pass)"| C["完成 (Done)"]
    B -->|"失敗 (Fail)"| D["錯誤訊息 (Error)"]
    D -->|"重試 (Retry)"| A

    2️⃣ 複雜版 (Complex) — 含子圖、決策、多分支

    mermaid
    flowchart TB
    Start(["開始 (Start)"]) --> Auth{"已登入?(Authenticated?)"}

        Auth -->|"否 (No)"| Login["登入流程(Login Flow)"]
        Login -->|"OAuth 成功"| Auth
        Login -->|"失敗 (Failed)"| Err1["顯示錯誤"]

        Auth -->|"是 (Yes)"| Dashboard["儀表板(Dashboard)"]

        subgraph 功能區 ["核心功能 (Core Features)"]
            direction TB
            Dashboard --> View["檢視資料(View)"]
            Dashboard --> Edit["編輯資料(Edit)"]
            Dashboard --> Del["刪除資料(Delete)"]

            View --> Cache["讀取快取(Cache)"]
            Edit --> Save{"驗證輸入?(Valid?)"}
            Save -->|"通過"| DB[("資料庫(Database)")]
            Save -->|"不通過"| Warn["警告訊息(Warning)"]
            Warn --> Edit
            Del --> Confirm{"確認刪除?(Confirm?)"}
            Confirm -->|"是"| DB
            Confirm -->|"否"| Dashboard
        end

        DB --> Log["稽核日誌(Audit Log)"]
        Log --> Done(["結束 (Done)"])
        Err1 --> Done
