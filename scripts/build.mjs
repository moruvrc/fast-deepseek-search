import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, copyFileSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
const cwd=process.cwd();
const dist=path.join(cwd,'dist');
const compiled=path.join(cwd,'.compiled');
rmSync(dist,{recursive:true,force:true});
rmSync(compiled,{recursive:true,force:true});
execFileSync('tsc',['-p','tsconfig.json'],{cwd,stdio:'inherit'});
mkdirSync(dist,{recursive:true});
for(const file of ['manifest.json','README.md','LICENSE'])copyFileSync(path.join(cwd,file),path.join(dist,file));
const output={
  'background.js':'background.js',
  'content.js':'content.js',
  'deepseek.js':'deepseek.js',
  'deepseek-editor-main.js':'deepseek-editor-main.js',
  'sidebar/fallback.js':'sidebar/fallback.js'
};
for(const [source,dest] of Object.entries(output)){
  const out=path.join(dist,dest);mkdirSync(path.dirname(out),{recursive:true});
  const sourcePath=path.join(compiled,source);
  copyFileSync(sourcePath,out);
}
copyFileSync(path.join(cwd,'src/deepseek.css'),path.join(dist,'deepseek.css'));
cpSync(path.join(cwd,'src/sidebar/fallback.html'),path.join(dist,'sidebar/fallback.html'));
cpSync(path.join(cwd,'src/sidebar/fallback.css'),path.join(dist,'sidebar/fallback.css'));
cpSync(path.join(cwd,'src/assets'),path.join(dist,'assets'),{recursive:true});
const manifest=JSON.parse(readFileSync(path.join(dist,'manifest.json'),'utf8'));
const expect=[];
expect.push(manifest.background.scripts[0],manifest.sidebar_action.default_panel);
for(const item of manifest.content_scripts)expect.push(...item.js,...(item.css??[]));
for(const item of expect)if(!statSync(path.join(dist,item)).isFile())throw new Error(`Missing asset ${item}`);
rmSync(compiled,{recursive:true,force:true});
execFileSync('python',['scripts/package.py'],{cwd,stdio:'inherit'});
console.log('Built dist/ and two ZIP archives.');
