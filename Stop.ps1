$appDir = $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'app.py' } | ForEach-Object {
    $pidFile = Join-Path $appDir 'server.pid'
    if ((Test-Path $pidFile) -and $_.ProcessId -eq [int](Get-Content $pidFile)) { Stop-Process -Id $_.ProcessId }
}
