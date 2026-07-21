# 驗證 `log_doctor` 作為 `VS Code` 套件之實作計畫 (Verification Plan for log_doctor as a VS Code Extension)

本計劃旨在對 `log_doctor` 目錄下的 `VS Code` 延伸模組 (VS Code Extension) 進行完整驗證，確保其相依套件安裝、型別檢查、單元測試、編譯建置及打包打包流程皆能正常運作。

## 使用者審查 (User Review Required)

無重大程式碼或架構變更，僅執行專案之驗證命令。

## 開放問題 (Open Questions)

目前無開放問題。

## 預定變更 (Proposed Changes)

本驗證任務不預期修改任何原始碼檔案，僅執行以下驗證步驟。

### 驗證步驟說明 (Verification Steps)

- [ ] `步驟 1: 安裝相依套件 (Install Dependencies)`
    - 進入 `log_doctor` 目錄並執行安裝：

        ```bash
        npm install
        ```

    - 預期結果：成功下載並產生 `node_modules` 與 `package-lock.json`，且無任何錯誤。

- [ ] `步驟 2: 靜態型別檢查 (Static Type Check)`
    - 執行 `TypeScript` 型別檢查：

        ```bash
        npm run lint
        ```

    - 預期結果：編譯器無回報任何型別錯誤。

- [ ] `步驟 3: 執行單元測試 (Run Unit Tests)`
    - 使用 `Vitest` 執行專案定義的單元測試：

        ```bash
        npm test
        ```

    - 預期結果：所有測試案例皆順利通過 (Pass)。

- [ ] `步驟 4: 編譯專案 (Build Project)`
    - 執行編譯指令：

        ```bash
        npm run build
        ```

    - 預期結果：於 `out` 目錄產生對應的 `JavaScript` 產物與 `source map`。

- [ ] `步驟 5: 打包套件 (Package Extension)`
    - 執行套件打包指令：

        ```bash
        npm run package
        ```

    - 預期結果：成功產生副檔名為 `.vsix` 的安裝檔。

## 驗證計畫 (Verification Plan)

### 自動化測試 (Automated Tests)

- `cd log_doctor && npm install`
- `cd log_doctor && npm run lint`
- `cd log_doctor && npm test`
- `cd log_doctor && npm run build`
- `cd log_doctor && npm run package`

### 手動驗證 (Manual Verification)

- 確認打包產生的 `.vsix` 檔案大小與檔案結構正常。
