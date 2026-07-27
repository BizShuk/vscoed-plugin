const SUPPORTED_EXECUTABLES = new Set([
  'codex',
  'claude',
  'claude-code',
  'claudem',
]);
const WRAPPERS = new Set(['command', 'env', 'sudo']);

export function isSupportedTuiCommand(commandLine: string): boolean {
  return commandLine.split(/&&|\|\||[;|]/).some((segment) => {
    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    let index = 0;

    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) {
      index += 1;
    }
    while (WRAPPERS.has(unquote(tokens[index] ?? ''))) {
      index += 1;
      while (
        (tokens[index] ?? '').startsWith('-') ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')
      ) {
        index += 1;
      }
    }

    const executable = unquote(tokens[index] ?? '').split('/').at(-1) ?? '';
    return SUPPORTED_EXECUTABLES.has(executable);
  });
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
