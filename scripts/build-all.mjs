import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync,readFileSync,writeFileSync,copyFileSync,cpSync,existsSync} from 'node:fs';
import path from 'node:path';
const cwd=process.cwd(), root=path.join(cwd,'releases'), compiled=path.join(cwd,'.compiled');
rmSync(root,{recursive:true,force:true});rmSync(compiled,{recursive:true,force:true});
execFileSync('tsc',['-p','tsconfig.json'],{cwd,stdio:'inherit'});
const browsers=[
  ['firefox','Firefox','firefox'],['chrome','Google Chrome','native'],['edge','Microsoft Edge','native'],
  ['brave','Brave','native'],['vivaldi','Vivaldi','native'],['opera','Opera','fallback'],
  ['opera-gx','Opera GX','fallback'],['yandex','Яндекс Браузер','fallback'],['chromium','Chromium','native']
];
const VERSION='2.0.0';
function destFile(dir,name,src){const full=path.join(dir,name);mkdirSync(path.dirname(full),{recursive:true});copyFileSync(src,full);}
for(const [slug,name,mode] of browsers){
  const dir=path.join(root,slug);mkdirSync(dir,{recursive:true});
  for(const file of ['LICENSE','README.md'])destFile(dir,file,path.join(cwd,file));
  cpSync(path.join(cwd,'src/assets'),path.join(dir,'assets'),{recursive:true});
  for(const file of ['content.js','deepseek.js','deepseek-editor-main.js'])destFile(dir,file,path.join(compiled,file));
  if(mode==='firefox'){
    destFile(dir,'background.js',path.join(compiled,'background.js'));
    destFile(dir,'deepseek.css',path.join(cwd,'src/deepseek.css'));
    for(const file of ['fallback.html','fallback.css'])destFile(dir,`sidebar/${file}`,path.join(cwd,`src/sidebar/${file}`));
    destFile(dir,'sidebar/fallback.js',path.join(compiled,'sidebar/fallback.js'));
    let manifest=JSON.parse(readFileSync('manifest.json','utf8'));
    manifest.version=VERSION;manifest.description='Выделяйте текст и отправляйте в официальный DeepSeek в Firefox Sidebar.';
    writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  }else{
    destFile(dir,'background.js',path.join(cwd,'chromium/background.js'));
    destFile(dir,'compat.js',path.join(cwd,'chromium/compat.js'));
    for(const file of ['index.html','panel.css','panel.js'])destFile(dir,`panel/${file}`,path.join(cwd,`chromium/panel/${file}`));
    const native=mode==='native';
    const manifest={
      manifest_version:3,name:`moru's deepseek`,version:VERSION,
      description:`moru's deepseek для ${name}: выделение текста и официальный DeepSeek без API-ключа.`,
      minimum_chrome_version:'120',
      permissions:['storage','tabs','contextMenus',...(native?['sidePanel']:[])],
      host_permissions:['<all_urls>'],
      background:{service_worker:'background.js'},
      action:{default_title:`moru's deepseek — ${name}`,default_icon:{'16':'assets/whale-16.png','32':'assets/whale-32.png'}},
      icons:{'16':'assets/whale-16.png','32':'assets/whale-32.png','48':'assets/whale-48.png','128':'assets/whale-128.png'},
      content_scripts:[
        {matches:['<all_urls>'],js:['compat.js','content.js'],run_at:'document_idle',all_frames:true,match_origin_as_fallback:true},
        {matches:['https://chat.deepseek.com/*'],js:['compat.js','deepseek.js'],run_at:'document_start',all_frames:false},
        {matches:['https://chat.deepseek.com/*'],js:['deepseek-editor-main.js'],world:'MAIN',run_at:'document_start',all_frames:false}
      ],
      ...(native?{side_panel:{default_path:'panel/index.html'}}:{})
    };
    writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  }
  writeFileSync(path.join(dir,'BROWSER.txt'),`${name}\nVersion: ${VERSION}\nMode: ${mode}\nBrowser integration is not independently verified in ${name}.\nChromium-based browsers use the official DeepSeek companion tab rather than a remote iframe.\nRead README.md before production deployment.\n`);
}
rmSync(compiled,{recursive:true,force:true});
console.log(`Built ${browsers.length} browser-specific directories in ${root}`);
