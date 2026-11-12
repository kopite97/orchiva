param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$daemonHome = Join-Path $env:USERPROFILE '.paseo-orchiva'
# These select packaged desktop Core activation, which an independent daemon
# does not have. Leave Windows sandbox and approval configuration unchanged.
$selectors = @('CODEX_WINDOWS_REGISTERED_CORE', 'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY')
$saved = @{}
foreach ($name in $selectors) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
try {
    if ($Restart) {
        & paseo daemon stop --home $daemonHome
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the Orchiva daemon.' }
    }
    & paseo daemon start --home $daemonHome --timeout 45
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the Orchiva daemon.' }
} finally {
    foreach ($name in $selectors) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
}
