#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"

cd "${project_dir}"
npm run package

extension_version="$(node -p "require('./package.json').version")"
vsix_path="${project_dir}/vscode-plugin-experiment-${extension_version}.vsix"

if [[ ! -f "${vsix_path}" ]]; then
    echo "Expected VSIX was not created: ${vsix_path}" >&2
    exit 1
fi

agy-ide --install-extension "${vsix_path}" --force

echo
echo "Installed vscode-plugin-experiment ${extension_version}."
echo "Run 'Developer: Reload Window' in Antigravity IDE, then start a new codex or claude terminal command."
