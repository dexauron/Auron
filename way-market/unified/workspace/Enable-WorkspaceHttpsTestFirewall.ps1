param([string]$ConfigPath=(Join-Path $env:ProgramData 'WayMarket-Workspace-Test\https-test.json'))
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this specific firewall step as administrator.'}
$json=Get-Content -LiteralPath $ConfigPath -Encoding UTF8 -Raw
if($json.Length -gt 16384){throw 'Invalid configuration size.'}
$c=$json|ConvertFrom-Json
if (($c.port -isnot [int] -and $c.port -isnot [long]) -or ($c.version -isnot [int] -and $c.version -isnot [long]) -or $c.clientAddresses -isnot [array]) { throw 'Port and version must be integers; client addresses must be an array.' }
function PrivateIp([string]$v){$ip=$null;if(-not [Net.IPAddress]::TryParse($v,[ref]$ip)-or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -ne $v){return $false};$b=$ip.GetAddressBytes();return $b[0] -eq 10 -or ($b[0] -eq 192 -and $b[1] -eq 168) -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31)}
if($c.version -ne 1 -or -not (PrivateIp $c.bindAddress) -or $c.port -lt 1024 -or $c.port -gt 65535 -or @($c.clientAddresses).Count -lt 1 -or @($c.clientAddresses).Count -gt 32 -or @($c.clientAddresses | Where-Object { -not (PrivateIp $_) }).Count){throw 'Only explicit private IPv4 devices and a test port are permitted.'}
$interface=Get-NetIPAddress -IPAddress $c.bindAddress -AddressFamily IPv4
$profile=Get-NetConnectionProfile -InterfaceIndex $interface.InterfaceIndex
if($profile.NetworkCategory -ne 'Private'){throw 'The server interface is not a Private network. Verify network isolation; this script will not change its category.'}
$node=(Get-Command node -CommandType Application).Source
$name='WayMarket-Workspace-HTTPS-Test-'+$c.port+'-'+$c.bindAddress.Replace('.','-')
if(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue){throw 'A rule with this name exists; inspect it instead of overwriting it.'}
Write-Host "Creating ONE inbound rule for $($c.bindAddress):$($c.port), $node"
Write-Host ('Approved remote devices: '+($c.clientAddresses-join', '))
New-NetFirewallRule -Name $name -DisplayName 'Way Market HTTPS TEST - approved devices' -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalAddress $c.bindAddress -LocalPort $c.port -RemoteAddress $c.clientAddresses -Program $node -EdgeTraversalPolicy Block|Out-Null
Write-Host "Rule created: $name"
Write-Host 'No router forwarding, RDP or database sharing was configured.'
