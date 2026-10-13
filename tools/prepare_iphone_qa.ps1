$ErrorActionPreference='Stop'
$taskRepo=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepo
$taskProtectedHeaders=Join-Path $taskRepo '../Codigo-product-next/tmp/cloud-stage/extra-headers.dpapi'
$taskSecure=(Get-Content -LiteralPath $taskProtectedHeaders -Raw).Trim()|ConvertTo-SecureString
$taskHeaders=([pscredential]::new('unused',$taskSecure)).GetNetworkCredential().Password|ConvertFrom-Json
if(-not $taskHeaders.cookie -or $taskHeaders.cookie -match '[\r\n"]'){throw 'private_cookie_missing_or_invalid'}
$taskConfig=Get-Content -LiteralPath 'ios/Blank/config/iPhoneQA113.xcconfig.example' -Raw
$taskConfig=$taskConfig.Replace('BLANK_PRIVATE_QA_COOKIE =',('BLANK_PRIVATE_QA_COOKIE = "'+$taskHeaders.cookie+'"'))
$taskDirectory=Join-Path $taskRepo 'tmp/appstore-final'
New-Item -ItemType Directory -Path $taskDirectory -Force|Out-Null
$taskPath=Join-Path $taskDirectory 'qa113.xcconfig'
[System.IO.File]::WriteAllText($taskPath,$taskConfig,[System.Text.UTF8Encoding]::new($false))
$taskAcl=[System.Security.AccessControl.FileSecurity]::new()
$taskAcl.SetAccessRuleProtection($true,$false)
$taskUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAcl.SetAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($taskUser,'FullControl','Allow'))
Set-Acl -LiteralPath $taskPath -AclObject $taskAcl
$taskSecure=$null;$taskHeaders=$null;$taskConfig=$null
Write-Output ('Private QA configuration ready: '+$taskPath)
Write-Output ('SHA256 '+(Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash)
