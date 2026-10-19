param([string]$ServerIp='192.168.1.132',[string[]]$ClientIp,[string]$ConfigFileName='https-test.json')
$ErrorActionPreference = 'Stop'
function Test-PrivateIPv4([string]$Value) {
  $ip = $null
  if (-not [Net.IPAddress]::TryParse($Value,[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -ne $Value) { return $false }
  $b=$ip.GetAddressBytes(); return $b[0] -eq 10 -or ($b[0] -eq 192 -and $b[1] -eq 168) -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31)
}
if (-not (Test-PrivateIPv4 $ServerIp)) { throw 'Choose a specific private IPv4 of this server.' }
if (-not (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object IPAddress -eq $ServerIp)) { throw 'This IP is not assigned to this server.' }
if (-not $ClientIp) { $ClientIp = (Read-Host 'Approved device IPv4 addresses, separated by commas').Split(',') | ForEach-Object { $_.Trim() } }
if ($ClientIp.Count -lt 1 -or $ClientIp.Count -gt 32 -or @($ClientIp | Select-Object -Unique).Count -ne $ClientIp.Count -or @($ClientIp | Where-Object { -not (Test-PrivateIPv4 $_) }).Count) { throw 'Use 1 to 32 distinct private device IPv4 addresses, not a subnet.' }
if ($ConfigFileName -notmatch '^[a-zA-Z0-9._-]+\.json$') { throw 'Choose a simple JSON configuration filename.' }
$DataDir = Join-Path $env:ProgramData 'WayMarket-Workspace-Test'
$AppDir = $PSScriptRoot
if ((Split-Path -Leaf $AppDir) -ne 'Way-Market-Workspace-Test-0.5') { throw 'Extract the release into its own Way-Market-Workspace-Test-0.5 folder. Never run ACL preparation from a drive root, user folder or shared application parent.' }
$ConfigFile = Join-Path $DataDir $ConfigFileName
if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'workspace-test.sqlite'))) { throw 'First create the owner and test data using start-workspace-test.cmd.' }
if (Test-Path -LiteralPath $ConfigFile) { throw 'Configuration already exists. Nothing was overwritten; choose another ConfigFileName for renewal.' }
if (Get-NetTCPConnection -State Listen -LocalPort 3211,3443 -ErrorAction SilentlyContinue) { throw 'Stop the workspace servers on ports 3211 and 3443 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'workspace-https.mjs'))) { throw 'Run from the extracted TEST 0.5 application folder.' }
Write-Host "Protecting ONLY the test data and this application: $DataDir ; $AppDir"
Write-Host 'No router, firewall, certificate trust store or Windows service will be changed.'
function Protect-Path([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Protected paths must not contain links or junctions.' }
  $acl = if ($item.PSIsContainer) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')) {
    $identity=New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = if ($item.PSIsContainer) { New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow') } else { New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow') }
    $acl.AddAccessRule($rule)
  }
  $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
  if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { Protect-Path $child.FullName } }
}
Protect-Path $DataDir
Protect-Path $AppDir
$TlsDir=Join-Path $DataDir ('tls-test-'+[guid]::NewGuid().ToString())
$null=New-Item -ItemType Directory -Path $TlsDir
Protect-Path $TlsDir
$secret=Read-Host 'PFX password phrase (15-128 characters; keep it separate from backups)' -AsSecureString
$again=Read-Host 'Repeat PFX password' -AsSecureString
function Unwrap([Security.SecureString]$Value) { $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value); try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }
$first=Unwrap $secret; $second=Unwrap $again
if ($first.Length -lt 15 -or $first.Length -gt 128 -or $first -cne $second -or $first -match '[\x00-\x1f]') { $first=$null; $second=$null; throw 'Passwords differ or have an invalid length.' }
$first=$null; $second=$null; $again.Dispose()
$id=[guid]::NewGuid().ToString().Substring(0,8)
$root=New-SelfSignedCertificate -Type Custom -Subject "CN=Way Market TEST Root $id" -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') -CertStoreLocation 'Cert:\CurrentUser\My' -NotBefore (Get-Date).AddMinutes(-5) -NotAfter (Get-Date).AddDays(365)
$leaf=New-SelfSignedCertificate -Type Custom -Subject "CN=Way Market TEST $ServerIp" -Signer $root -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @("2.5.29.17={text}IPAddress=$ServerIp",'2.5.29.37={text}1.3.6.1.5.5.7.3.1') -CertStoreLocation 'Cert:\CurrentUser\My' -NotBefore (Get-Date).AddMinutes(-5) -NotAfter (Get-Date).AddDays(90)
$pfx=Join-Path $TlsDir 'server.pfx'; $cer=Join-Path $TlsDir 'server.cer'; $ca=Join-Path $TlsDir 'trust-root.cer'
try { $null=Export-PfxCertificate -Cert $leaf -FilePath $pfx -Password $secret -CryptoAlgorithmOption AES256_SHA256 -ChainOption EndEntityCertOnly -NoClobber } finally { $secret.Dispose() }
$null=Export-Certificate -Cert $leaf -FilePath $cer -Type CERT
$null=Export-Certificate -Cert $root -FilePath $ca -Type CERT
$config=[ordered]@{version=1;bindAddress=$ServerIp;port=3443;publicOrigin="https://${ServerIp}:3443";clientAddresses=@($ClientIp);pfxPath=$pfx;certificatePath=$cer;caPath=$ca;maxBackupAgeMinutes=1440}
# UTF-8 without BOM, including on Windows PowerShell 5.1.
[IO.File]::WriteAllText($ConfigFile,($config|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
Protect-Path $TlsDir
Protect-Path $ConfigFile
Write-Host "Configuration: $ConfigFile"
Write-Host "Share ONLY this public root certificate with approved devices: $ca"
Write-Host ('Verify its SHA256 independently: '+(Get-FileHash -LiteralPath $ca -Algorithm SHA256).Hash)
Write-Host 'Never share server.pfx, its password, a database or the private CA key.'
Write-Host 'Next: start-workspace-https-test.cmd. Trust installation and restricted firewall access are separate operator steps.'
