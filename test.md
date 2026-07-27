print below mermaid syntax exactly for testing preview.

• Mermaid 圖示範 (Diagram Examples)

mermaid
flowchart LR
A["使用者輸入 (Input)"] -->|"送出 (Submit)"| B["驗證 (Validate)"]
B -->|"通過 (Pass)"| C["完成 (Done)"]
B -->|"失敗 (Fail)"| D["錯誤訊息 (Error)"]
D -->|"重試 (Retry)"| A

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

1. 最簡 LR（有 <br/> 測 normalizer）

mermaid
flowchart LR
Start(["開始<br/>(Start)"]) --> Choice{"選擇?<br/>(Pick?)"}
Choice -->|"是 (Yes)"| Pass["通過<br/>(Pass)"]
Choice -->|"否 (No)"| Fail["失敗<br/>(Fail)"]
Pass --> End(["結束<br/>(End)"])
Fail --> End

測試：flowchart LR + 中文 label + <br/> + Stadium ([()])

2. Subgraph + 跨範圍引用（per-id slot 試金石）

mermaid
flowchart TB
User(["User"]) --> Login["登入"]
Login --> CoreApp
Login --> Admin
subgraph CoreApp ["核心 App"]
direction TB
Dashboard["儀表板<br/>Dashboard"] --> View["檢視"]
Dashboard --> Edit["編輯<br/>Edit"]
end
subgraph Admin ["後台"]
direction TB
AdminPanel["管理面板"] --> Users["用戶管理"]
AdminPanel --> Logs["日誌"]
end
Admin --> CoreApp

測試：兩個 subgraph 並存，不同 id slot。Codex 跟你之前斷掉的版型類似。

3. Sequence（換 directive family）

mermaid
sequenceDiagram
participant U as 使用者
participant A as API
participant D as 資料庫
U->>A: 登入請求
A->>D: 查 token
D-->>A: token
A-->>U: 回應

測試：跳離 flowchart 走 sequenceDiagram 路徑，確保 directive 切換不混到前一個 cache。

4. ER（雙 \_ 開頭的關係線）

mermaid
erDiagram
USER ||--o{ ORDER : "下單"
ORDER ||--|{ LINE_ITEM : "包含"
USER {
int id PK
string name
}
ORDER {
int id PK
date created
}

測試：erDiagram directive + 特殊關係符 ||--o{。

5. State diagram

mermaid
stateDiagram-v2
[*] --> 待處理
待處理 --> 處理中: 接收
處理中 --> 完成: 成功
處理中 --> 失敗: 錯誤
失敗 --> 處理中: 重試
完成 --> [*]

測試：transition 文字 A: B 格式 + 中文 state 名。

6. Mindmap（完全不同 layout）

mermaid
mindmap
root((Mermaid))
流程
LR
TB
RL
時序
sequence
state
結構
class
er
進度
gantt
pie

測試：mindmap 用 (( 跟 ) 當圓形節點，跟其他 directive 不一樣。

7. 大量編輯測試（stress）

這組是「同一個 id 反覆 record」的試金石，驗 per-id overwrite：

mermaid
flowchart LR
Step1 --> Step2

mermaid
flowchart LR
Step1 --> Step2
Step2 --> Step3

mermaid
flowchart LR
Step1 --> Step2
Step2 --> Step3
Step3 --> Step4
