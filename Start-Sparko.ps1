param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$previousSparkoPort = $env:PORT
Push-Location -LiteralPath $PSScriptRoot

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 24, then run this script again.'
    }

    if (-not (Test-Path -LiteralPath 'node_modules/tsx/dist/cli.mjs')) {
        Write-Host 'Installing Sparko dependencies...'
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) {
            throw 'Dependency installation failed. Check the npm output above.'
        }
    }

    $env:PORT = [string]$Port
    Write-Host "Starting Sparko at http://127.0.0.1:$Port"
    Write-Host 'Leave this window open. Press Ctrl+C to stop.'
    & node node_modules/tsx/dist/cli.mjs watch server/index.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Sparko stopped with exit code $LASTEXITCODE."
    }
}
finally {
    $env:PORT = $previousSparkoPort
    Pop-Location
}
