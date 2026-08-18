# Launches Final Drafter over http://127.0.0.1 instead of file://, which is
# what OCR (tesseract.js, worker+WASM) and autosave/version history (needs
# reliable IndexedDB) both require. See scripts/serve.js for why.
#
# Invoked by launch-final-drafter.bat; not meant to be run standalone.

$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $PSScriptRoot   # scripts/ -> repo root
Set-Location $Dir

$DefaultPort = 8743

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

function Open-Url($chrome, $url) {
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList "--app=$url" }
    else { Start-Process $url }
}

function Open-FileFallback($chrome) {
    Write-Warning 'Falling back to file:// -- OCR and autosave will not work.'
    $page = Join-Path $Dir 'empty.html'
    $fileUrl = 'file:///' + ($page -replace '\\', '/')
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList "--app=$fileUrl" }
    else { Start-Process $page }
}

function Test-ServerUp($port) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/empty.html" -UseBasicParsing -TimeoutSec 1
        return $resp.StatusCode -eq 200
    } catch { return $false }
}

$chrome = Find-Chrome
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
    Open-FileFallback $chrome
    return
}

# A launch from a moment ago may already be serving -- reuse it instead of
# spawning a second node process fighting over ports.
if (Test-ServerUp $DefaultPort) {
    Open-Url $chrome "http://127.0.0.1:$DefaultPort/empty.html"
    return
}

$serverLog = Join-Path $env:TEMP 'final-drafter-server.log'
$serverErrLog = Join-Path $env:TEMP 'final-drafter-server.err.log'
Start-Process -FilePath $node.Source `
    -ArgumentList @((Join-Path $Dir 'scripts\serve.js'), $DefaultPort) `
    -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrLog | Out-Null

$port = $null
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    if (Test-Path $serverLog) {
        $match = Select-String -Path $serverLog -Pattern '^LISTENING:(\d+)' -ErrorAction SilentlyContinue
        if ($match) { $port = $match.Matches[0].Groups[1].Value; break }
    }
}

if ($port) {
    Open-Url $chrome "http://127.0.0.1:$port/empty.html"
} else {
    Open-FileFallback $chrome
}
