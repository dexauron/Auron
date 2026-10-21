param([Parameter(Mandatory=$true)][string]$DataDirectory,[Parameter(Mandatory=$true)][string]$TlsDirectory,[Parameter(Mandatory=$true)][string]$ApplicationDirectory,[Parameter(Mandatory=$true)][string]$ConfigPath,[string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
$writeMask = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
function Check-Path([string]$Path,[bool]$Private) {
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not supported for protected workspace paths.' }
  $acl = Get-Acl -LiteralPath $item.FullName
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($trusted -notcontains $owner) { throw "Untrusted owner: $Path" }
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $trusted -notcontains $rule.IdentityReference.Value) {
      if ($Private -or ($rule.FileSystemRights -band $writeMask) -ne 0) { throw "Access is too broad: $Path" }
    }
  }
  if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { Check-Path $child.FullName $Private } }
}
Check-Path $DataDirectory $true
Check-Path $TlsDirectory $true
Check-Path $ApplicationDirectory $false
Check-Path $ConfigPath $true
if ($BackupDirectory -and (Test-Path -LiteralPath $BackupDirectory)) { Check-Path $BackupDirectory $true }
Write-Output 'Workspace permissions: OK'
