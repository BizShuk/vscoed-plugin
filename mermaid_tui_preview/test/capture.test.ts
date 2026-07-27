import { describe, expect, it, vi } from 'vitest';
import type { DetectedMermaidDiagram } from '../src/detector';
import {
  captureMermaidStream,
  TerminalScreen,
} from '../src/terminal';

async function* chunks(values: readonly string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value;
  }
}

describe('captureMermaidStream', () => {
  it('detects a diagram after applying incremental TUI redraws', async () => {
    const detections: DetectedMermaidDiagram[][] = [];

    await captureMermaidStream(
      chunks([
        '\u001b[?1049h\u001b[H\r\u001b[12B⏺\u001b[3Gmermaid',
        '\r\u001b[2C\u001b[1Bflowchart\u001b[13GTD',
        '\r\u001b[6C\u001b[1BA[Start]\u001b[16G-->\u001b[20GB[Done]',
      ]),
      new TerminalScreen(),
      (diagrams) => detections.push([...diagrams]),
    );

    expect(detections.at(-1)).toEqual([
      {
        source: 'flowchart TD\n    A[Start] --> B[Done]',
        directive: 'flowchart',
        marker: 'mermaid',
      },
    ]);
  });

  it('preserves a diagram that is overwritten later in the same TUI chunk', async () => {
    const detections: DetectedMermaidDiagram[][] = [];
    const raw =
      '\u001b[?1049h\u001b[H⏺\u001b[3Gmermaid' +
      '\r\u001b[2C\u001b[1Bflowchart\u001b[13GTD' +
      '\r\u001b[6C\u001b[1BA[Start]\u001b[16G-->\u001b[20GB[Done]' +
      '\u001b[HProcess --> B' +
      '\r\u001b[1BQueue --> C' +
      '\r\u001b[1BWorker --> D';

    await captureMermaidStream(
      chunks([raw]),
      new TerminalScreen(),
      (diagrams) => detections.push([...diagrams]),
    );

    expect(
      detections
        .flat()
        .some(
          (diagram) =>
            diagram.directive === 'flowchart' &&
            diagram.source.startsWith('flowchart TD\n') &&
            diagram.source.includes('A[Start] --> B[Done]'),
        ),
    ).toBe(true);
  });

  it('preserves a wrapped Claude flowchart as exact logical lines', async () => {
    const source = `flowchart TB
Start(["開始 (Start)"]) --> Auth{"已登入?<br/>(Authenticated?)"}

    Auth -->|"否 (No)"| Login["登入流程<br/>(Login Flow)"]
    Login -->|"OAuth 成功"| Auth
    Login -->|"失敗 (Failed)"| Err1["顯示錯誤"]

    Auth -->|"是 (Yes)"| Dashboard["儀表板<br/>(Dashboard)"]

    subgraph 功能區 ["核心功能 (Core Features)"]
        direction TB
        Dashboard --> View["檢視資料<br/>(View)"]
        Dashboard --> Edit["編輯資料<br/>(Edit)"]
        Dashboard --> Del["刪除資料<br/>(Delete)"]

        View --> Cache["讀取快取<br/>(Cache)"]
        Edit --> Save{"驗證輸入?<br/>(Valid?)"}
        Save -->|"通過"| DB[("資料庫<br/>(Database)")]
        Save -->|"不通過"| Warn["警告訊息<br/>(Warning)"]
        Warn --> Edit
        Del --> Confirm{"確認刪除?<br/>(Confirm?)"}
        Confirm -->|"是"| DB
        Confirm -->|"否"| Dashboard
    end

    DB --> Log["稽核日誌<br/>(Audit Log)"]
    Log --> Done(["結束 (Done)"])
    Err1 --> Done`;
    const renderedLines = [
      '⏺ mermaid',
      ...source.split('\n').map((line) => `  ${line}`),
    ];
    const detections: DetectedMermaidDiagram[][] = [];

    await captureMermaidStream(
      chunks([
        `\u001b[?1049h\u001b[H${renderedLines.join('\r\n')}`,
      ]),
      new TerminalScreen({ columns: 80, rows: 30 }),
      (diagrams) => detections.push([...diagrams]),
    );

    expect(detections.at(-1)?.[0]?.source).toBe(source);
  });

  it('always disposes the screen when the stream fails', async () => {
    let disposed = false;
    const screen = {
      write: async () => [] as readonly string[],
      dispose: () => {
        disposed = true;
      },
    };
    const failingStream = (async function* () {
      yield 'first';
      throw new Error('stream failed');
    })();

    await expect(
      captureMermaidStream(failingStream, screen, () => undefined),
    ).rejects.toThrow('stream failed');
    expect(disposed).toBe(true);
  });

  it('does not write raw terminal frames to the console', async () => {
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const screen = {
      write: async () => [] as readonly string[],
      dispose: () => undefined,
    };

    try {
      await captureMermaidStream(
        chunks(['secret terminal output']),
        screen,
        () => undefined,
      );

      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
