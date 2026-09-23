param([string]$Python = 'python', [string]$Pnpm = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12 or newer is required.' }
if ($Pnpm) {
    $packageCommand = $Pnpm
    $packagePrefix = @()
} elseif (Get-Command npx.cmd -ErrorAction SilentlyContinue) {
    $packageCommand = 'npx.cmd'
    $packagePrefix = @('--yes', 'pnpm@11.19.0')
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $packageCommand = (Get-Command pnpm).Source
    $packagePrefix = @()
} else {
    throw 'Install Node.js with npm, or pass -Pnpm with the path to pnpm 11.19.0.'
}
if ($packagePrefix.Count -eq 0) {
    $packageVersion = (& $packageCommand --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $packageVersion -ne '11.19.0') { throw 'pnpm 11.19.0 is required.' }
}
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        & $Python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or newer is required. Use -Python with the interpreter path.' }
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or newer is required.' }
    }
    & '.\.venv\Scripts\python.exe' -m pip install -r backend/requirements-lock.txt
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    Push-Location frontend
    try {
        & $packageCommand @packagePrefix install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        & $packageCommand @packagePrefix build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
    Write-Host 'Ready. Run .\.venv\Scripts\python.exe run.py'
} finally { Pop-Location }
