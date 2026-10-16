"""Verify native-browser packages and create reproducible-ish ZIP artifacts."""
from __future__ import annotations
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
import json, subprocess, shutil
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/mnt/data/moru-deepseek-releases-2.0.0')
OUT.mkdir(parents=True, exist_ok=True)
VER='2.0.0'
BROWSERS=['firefox','chrome','edge','brave','vivaldi','opera','opera-gx','yandex','chromium']
CHECK=['README.md','LICENSE','assets/whale.svg','content.js','deepseek.js','deepseek-editor-main.js']
NATIVE=['chrome','edge','brave','vivaldi','chromium']
report=['moru\'s deepseek 2.0.0 — проверка артефактов','',
'СТАТУС: релиз-кандидат. Не является подтвержденной продакшен-сборкой.',
'Пройдены: TypeScript, 13 JS unit-тестов, браузерные offline mock тесты основного редактора (6 сценариев), выделения/iframe/Shadow DOM, зеркала DOM, UI Chromium 320 px.',
'Не пройдены/не доступны: загрузка установленного MV3 расширения в Chromium данной среды (политика браузера); реальная авторизация/отправка в DeepSeek; отдельные живые тесты Opera, Opera GX, Edge, Brave, Yandex, Vivaldi, Firefox.',
'Действие до релиза: провести smoke + E2E тесты во всех поддерживаемых браузерах, проверить подпись и магазины.',
'', 'АВТОПРОВЕРКА АРХИВОВ:']
for slug in BROWSERS:
    folder=ROOT/'releases'/slug
    man=json.loads((folder/'manifest.json').read_text())
    assert man['manifest_version']==3 and man['version']==VER and man['name']=="moru's deepseek", slug
    expected=CHECK+['manifest.json','BROWSER.txt','background.js']
    if slug=='firefox':
        assert man['background']['scripts']==['background.js']
        assert man['sidebar_action']['default_panel']=='sidebar/fallback.html'
        expected+=['deepseek.css','sidebar/fallback.css','sidebar/fallback.html','sidebar/fallback.js']
    else:
        assert man['background']['service_worker']=='background.js'
        assert len(man['content_scripts'])==3
        expected+=['compat.js','panel/index.html','panel/panel.css','panel/panel.js']
        if slug in NATIVE:assert man['side_panel']['default_path']=='panel/index.html' and 'sidePanel' in man['permissions']
        else:assert 'side_panel' not in man and 'sidePanel' not in man['permissions']
    for f in expected:assert (folder/f).is_file(),(slug,f)
    for group in man['content_scripts']:
        for f in group.get('js',[])+group.get('css',[]):assert (folder/f).is_file(),(slug,f)
    for f in [p for p in folder.rglob('*.js')]:
        result=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
        assert result.returncode==0,(slug,f,result.stderr)
    specific={
        'firefox':'Firefox: удалённая официальная страница DeepSeek внутри Firefox Sidebar.',
        'chrome':'Chrome: собственный Side Panel; DeepSeek в связанной вкладке.',
        'edge':'Edge: Chrome Side Panel API, зависит от версии Edge; DeepSeek в связанной вкладке.',
        'brave':'Brave: Chrome Side Panel API, зависит от версии Brave; DeepSeek в связанной вкладке.',
        'vivaldi':'Vivaldi: Chrome Side Panel API, зависит от версии Vivaldi; DeepSeek в связанной вкладке.',
        'chromium':'Chromium: собственный Side Panel; DeepSeek в связанной вкладке.',
        'opera':'Opera: интерфейс расширения отдельной вкладкой, DeepSeek в связанной вкладке.',
        'opera-gx':'Opera GX: интерфейс расширения отдельной вкладкой, DeepSeek в связанной вкладке.',
        'yandex':'Яндекс Браузер: интерфейс отдельной вкладкой; ZIP может потребовать пересборки в подписанный CRX3.'
    }[slug]
    (folder/'INSTALL-NOTE.txt').write_text('moru\'s deepseek v2.0.0\n'+specific+'\n\nНЕ ПУБЛИКОВАТЬ до живого теста в целевом браузере и настоящем DeepSeek.\nSee README.md.\n',encoding='utf8')
    dest=OUT/f'morus-deepseek-{slug}-{VER}.zip'
    with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=9) as z:
        for f in sorted(folder.rglob('*')):
            if f.is_file():z.write(f,f.relative_to(folder).as_posix())
    with ZipFile(dest) as z:
        assert 'manifest.json' in z.namelist() and z.testzip() is None
        parsed=json.loads(z.read('manifest.json'))
        assert parsed['version']==VER
    report.append(f'PASS {slug:10s} {dest.stat().st_size:>8d} B SHA256 {sha256(dest.read_bytes()).hexdigest()}')
# Source archive with build script and tests. No generated release duplicates.
source=OUT/f'morus-deepseek-source-{VER}.zip'
source_paths=[ROOT/'manifest.json',ROOT/'README.md',ROOT/'LICENSE',ROOT/'package.json',ROOT/'tsconfig.json',ROOT/'.gitignore']
for directory in ['src','chromium','scripts','tests']:
    source_paths += [p for p in (ROOT/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and not p.name.endswith('.pyc')]
with ZipFile(source,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(set(source_paths)):
        z.write(p,('morus-deepseek/'+p.relative_to(ROOT).as_posix()))
with ZipFile(source) as z:assert z.testzip() is None
report.append(f'SOURCE ZIP SHA256 {sha256(source.read_bytes()).hexdigest()}')
report_text='\n'.join(report)+'\n';(OUT/'RELEASE-TEST-REPORT.txt').write_text(report_text)
allzip=OUT/f'morus-deepseek-all-browsers-{VER}.zip'
with ZipFile(allzip,'w',ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(OUT.glob('morus-deepseek-*.zip')):
        if file.name==allzip.name:continue
        z.write(file,file.name)
    z.write(OUT/'RELEASE-TEST-REPORT.txt','RELEASE-TEST-REPORT.txt')
with ZipFile(allzip) as z:
    assert z.testzip() is None and len(z.namelist())==11
print('\n'.join(report[-12:]))
print('ALL BROWSERS ZIP:',allzip,allzip.stat().st_size)
