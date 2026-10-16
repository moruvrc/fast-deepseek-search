from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
out = root / 'artifacts'
out.mkdir(exist_ok=True)

with ZipFile(out / f'morus-deepseek-firefox-{version}.zip', 'w', ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted((root / 'dist').rglob('*')):
        if p.is_file():
            z.write(p, p.relative_to(root / 'dist'))

exclude = {'.compiled', 'dist', 'node_modules', '.git', 'releases', 'downloads', 'artifacts'}
with ZipFile(out / f'morus-deepseek-source-{version}.zip', 'w', ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(root.rglob('*')):
        if not p.is_file() or any(part in exclude for part in p.relative_to(root).parts):
            continue
        if p.suffix.lower() in {'.zip', '.xpi'}:
            continue
        z.write(p, Path('morus-deepseek') / p.relative_to(root))
