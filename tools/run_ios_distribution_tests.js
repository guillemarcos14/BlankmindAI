const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.platform==='win32'?'python':'python3',[path.join(__dirname,'ios_sign_existing_archive_test.py')],{encoding:'utf8',windowsHide:true});
if(result.error)throw result.error;
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
process.exitCode=result.status??1;
