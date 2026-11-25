param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$url = "http://127.0.0.1:$port"
$lock = New-Object Threading.Mutex($false, "Local\XingYunJian-Start-$port")
$held = $false
function Test-Ready {
    try { (Invoke-RestMethod "$url/health" -TimeoutSec 2).status -eq 'ok' } catch { $false }
}
try {
    try { $held = $lock.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (!$held) { throw '另一次启动仍在进行，请稍后再试。' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count) {
        $saved = if (Test-Path server.pid) { (Get-Content server.pid -Raw).Trim() }
        if (($listeners.OwningProcess -notcontains $saved) -or !(Test-Ready)) {
            throw "端口 $port 已被其他实例或程序占用。请使用对应目录启动，或设置其他 PORT。"
        }
    } else {
        $exe = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
        $arguments = @('app.py')
        if (!(Test-Path -LiteralPath $exe)) {
            $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
            if ($launcher) { $exe = $launcher.Source; $arguments = @('-3','app.py') }
            else { $exe = (Get-Command python.exe -ErrorAction Stop).Source }
        }
        $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
        $ready = $false
        for ($i=0; $i -lt 50; $i++) {
            if ($process.HasExited) { throw "启动失败，进程退出码 $($process.ExitCode)。" }
            if (Test-Ready) { $ready=$true; break }
            Start-Sleep -Milliseconds 200
        }
        if (!$ready) { throw "服务未在预期时间内就绪：$url" }
    }
    if (!$NoBrowser) { Start-Process $url }
    Write-Output "项目协同已就绪 $url"
} finally {
    if ($held) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
