#!/usr/bin/env python3
"""Verify prebuilt release ZIP checksums and minimum packaging invariants.

This does NOT validate runtime integration with DeepSeek or browser stores.
"""
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile, BadZipFile

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = ROOT / 'downloads'
BROWSERS = ('firefox', 'chrome', 'edge', 'brave', 'vivaldi', 'opera', 'opera-gx', 'yandex', 'chromium')
EXPECTED = [f'morus-deepseek-{browser}-2.0.0.zip' for browser in BROWSERS]
EXPECTED += ['morus-deepseek-source-2.0.0.zip', 'morus-deepseek-all-browsers-2.0.0.zip']


def main():
    lines = (ROOT / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
    checksums = {}
    for line in lines:
        if not line.strip() or line.startswith('#'):
            continue
        sha, filename = line.split('  ', 1)
        checksums[filename.strip()] = sha.strip()
    errors = []
    for name in EXPECTED:
        path = DOWNLOADS / name
        if not path.is_file():
            errors.append(f'missing file: {path.relative_to(ROOT)}')
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if checksums.get(f'downloads/{name}') != digest:
            errors.append(f'SHA256 mismatch: {name}')
        try:
            with ZipFile(path) as archive:
                if archive.testzip():
                    errors.append(f'corrupt zip: {name}')
                if name in (EXPECTED[-2], EXPECTED[-1]):
                    continue
                files = set(archive.namelist())
                if 'manifest.json' not in files:
                    errors.append(f'manifest.json missing at ZIP root: {name}')
                    continue
                manifest = json.loads(archive.read('manifest.json'))
                if manifest.get('manifest_version') != 3 or manifest.get('version') != '2.0.0':
                    errors.append(f'wrong manifest version: {name}')
                if manifest.get('name') != "moru's deepseek":
                    errors.append(f'wrong extension name: {name}')
                required = ['content.js', 'deepseek.js', 'deepseek-editor-main.js', 'background.js', 'LICENSE']
                if 'firefox' in name:
                    required += ['sidebar/fallback.html']
                else:
                    required += ['panel/index.html', 'compat.js']
                for filename in required:
                    if filename not in files:
                        errors.append(f'missing in {name}: {filename}')
        except (BadZipFile, ValueError, json.JSONDecodeError) as exc:
            errors.append(f'unreadable zip {name}: {exc}')
        if not errors:
            print(f'PASS {name}: {digest}')
    unexpected = set(checksums) - {f'downloads/{name}' for name in EXPECTED}
    if unexpected:
        errors.append('checksum entries have unexpected paths: ' + ', '.join(sorted(unexpected)))
    if errors:
        print('\n'.join('FAIL ' + issue for issue in errors), file=sys.stderr)
        return 1
    print(f'PASS all {len(EXPECTED)} ZIP archives; metadata/integrity only (not E2E).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
