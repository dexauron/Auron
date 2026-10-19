import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import { join,dirname,isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { readNetworkConfig,loadNetworkTransport } from './workspace-network.mjs';
import { askSecret } from './secret-input.mjs';
import { openWorkspace } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { createBackupService } from './workspace-backups.mjs';

export async function startHttpsTest(configPath) {
  const appDir=dirname(fileURLToPath(import.meta.url));
  const dataDir=process.platform==='win32'?join(process.env.ProgramData??homedir(),'WayMarket-Workspace-Test'):join(homedir(),'.way-market-workspace-test');
  if(!isAbsolute(dataDir))throw new Error('Папка данных сервера должна быть абсолютной');
  configPath??=join(dataDir,'https-test.json');
  const config=await readNetworkConfig(configPath);
  const databasePath=join(dataDir,'workspace-test.sqlite'), info=await lstat(databasePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Нужна существующая тестовая рабочая база; пустая база для LAN не создаётся');
  const backupDir=process.env.WAY_MARKET_BACKUP_DIR||join(dataDir,'backups');
  if (!isAbsolute(backupDir)) throw new Error('Путь резервирования должен быть абсолютным');
  if (process.platform==='win32') {
    try { await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',join(appDir,'Test-WorkspacePermissions.ps1'),'-DataDirectory',dataDir,'-TlsDirectory',dirname(config.pfxPath),'-ApplicationDirectory',appDir,'-ConfigPath',configPath,'-BackupDirectory',backupDir],{timeout:60000,maxBuffer:65536,windowsHide:true}); }
    catch { throw new Error('Права Windows не прошли проверку. Закройте доступ посторонних к тестовой базе, TLS-файлам, резервам и записи в папку приложения'); }
  } else {
    for (const path of [dataDir,databasePath,dirname(config.pfxPath)]) if ((await lstat(path)).mode&0o077) throw new Error('Для сетевого теста нужны закрытые права на базу и каталоги данных/TLS');
  }
  const workspace=openWorkspace(databasePath);
  const backups=createBackupService(workspace,{directory:backupDir,restoreDirectory:join(dataDir,'restored')});
  let server;
  try {
    await backups.startupReadiness(config.maxBackupAgeMinutes);
    const transport=await loadNetworkTransport(config,await askSecret('Пароль TLS/PFX (ввод скрыт): '));
    ({server}=createWorkspaceServer(workspace,{backupService:backups,network:transport}));
    await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(config.port,config.bindAddress,resolve); });
    console.log(`Way Market HTTPS TEST 0.4: ${config.publicOrigin}`);
    console.log(`SHA256 доверенного центра: ${transport.caFingerprint}`);
    console.log(`Сертификат действует до: ${transport.expiresAt}`);
    console.log('Разрешены только указанные IP устройств. Настройки брандмауэра и роутера не изменены. Только вымышленные данные.');
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;server.closeIdleConnections();await new Promise(r=>server.close(r));await backups.close();workspace.close();};
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop().then(()=>{process.exitCode=0;},()=>{process.exitCode=1;});});
    return {server,close:stop};
  } catch(error) { if(server?.listening)await new Promise(r=>server.close(r));await backups.close();workspace.close();throw error; }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  try {
    if(args.length && (args.length!==2||args[0]!=='--config'||!isAbsolute(args[1])))throw new Error('Допустимо: --config "абсолютный путь конфигурации HTTPS"');
    await startHttpsTest(args[1]);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
