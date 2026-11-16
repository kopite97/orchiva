param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'
if ([Environment]::Version.Major -lt 10) { throw 'PowerShell on .NET 10 or later is required for this development harness.' }
$sourceRoot = Split-Path -Parent $PSScriptRoot
$assembly = Join-Path $sourceRoot 'desktop/Orchiva.Bridge/bin/x64/Debug/net10.0/Orchiva.Bridge.dll'
if (!(Test-Path -LiteralPath $assembly)) { throw 'Build the desktop project before starting the runtime.' }
[void][System.Reflection.Assembly]::LoadFrom($assembly)
$jsonOptions = [System.Text.Json.JsonSerializerOptions]::new()
$jsonOptions.PropertyNameCaseInsensitive = $true
$launch = [System.Text.Json.JsonSerializer]::Deserialize([System.IO.File]::ReadAllText($Config), [Orchiva.Bridge.LaunchOptions], $jsonOptions)
[void][Orchiva.Bridge.RuntimeLauncher]::StartAsync($launch, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
Write-Output 'PASS: isolated runtime ready through the desktop launcher'
