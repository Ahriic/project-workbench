$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$runtime=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if(Test-Path $runtime){ & $runtime maintenance.py backup }else{ py -3 maintenance.py backup }
