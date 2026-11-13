#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Address,
    [Parameter(Mandatory)] [ValidatePattern('^0x[0-9a-fA-F]{40}$')] [string] $Wallet,
    [Parameter(Mandatory)] [string] $Anvil,
    [Parameter(Mandatory)] [string] $Solc,
    [Parameter(Mandatory)] [string] $PhoneAddress,
    [ValidateRange(1024, 65535)] [int] $GatewayPort = 9443,
    [ValidateRange(1024, 65535)] [int] $WebPort = 3197,
    [ValidateRange(1024, 65535)] [int] $AnvilPort = 8547
)

$ErrorActionPreference = 'Stop'
if (@($GatewayPort, $WebPort, $AnvilPort | Select-Object -Unique).Count -ne 3) {
    throw 'Choose three distinct ports.'
}
if ($Wallet -match '^0x0+$' -or $env:VERCEL -or $env:VERCEL_ENV) {
    throw 'Use a fresh test wallet and a local Windows session.'
}
if ($PhoneAddress -notmatch '^\d{1,3}(?:\.\d{1,3}){3}$') {
    throw 'Enter the phone IPv4 address shown in its Wi-Fi settings.'
}
foreach ($port in @($GatewayPort, $WebPort, $AnvilPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use."
    }
}

$repo = Split-Path -Parent $PSScriptRoot
$web = Join-Path $repo 'apps/web'
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$anvilPath = (Resolve-Path -LiteralPath $Anvil).Path
$solcPath = (Resolve-Path -LiteralPath $Solc).Path
$next = Join-Path $web 'node_modules/next/dist/bin/next'
if (!(Test-Path -LiteralPath $next) -or !(Test-Path -LiteralPath (Join-Path $web '.next/BUILD_ID'))) {
    throw 'Install the frozen lockfile and build the web app before starting the fixture.'
}
$fork = (Get-Content -LiteralPath (Join-Path $repo 'packages/contracts/test/fixtures/rmt-v4-deployment-identities.json') -Raw |
    ConvertFrom-Json).baseSepolia
if ($fork.chainId -ne 84532 -or $fork.rpcUrl -ne 'https://sepolia.base.org') {
    throw 'The preview requires the pinned Base Sepolia read source.'
}
$tls = & (Join-Path $PSScriptRoot 'new-launchpad-lan-certificate.ps1') -Address $Address
$scratch = Split-Path -Parent $tls.Certificate
$rpc = "http://127.0.0.1:$AnvilPort/"
$backend = "http://127.0.0.1:$WebPort/"
$origin = "https://${Address}:$GatewayPort"
$processes = [Collections.Generic.List[Diagnostics.Process]]::new()

function Start-FixtureProcess($Executable, $Arguments, $Directory, $Name, $Variables = @{}) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory `
        -Environment $Variables -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $scratch "$Name.log") `
        -RedirectStandardError (Join-Path $scratch "$Name.error.log")
    $processes.Add($process)
    return $process
}

function Invoke-LocalRpc([string] $Method, [object[]] $Params = @()) {
    $request = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = $Params } | ConvertTo-Json -Depth 4 -Compress
    $reply = Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body $request -TimeoutSec 3
    if ($reply.error -or !$reply.PSObject.Properties['result']) { throw "Local fixture RPC rejected $Method." }
    return $reply.result
}

try {
    $forkProcess = Start-FixtureProcess $anvilPath @('--host', '127.0.0.1', '--port', "$AnvilPort", '--accounts', '0',
        '--chain-id', '31337', '--fork-url', $fork.rpcUrl, '--fork-block-number', "$($fork.block)", '--silent') $repo 'anvil'
    $chain = $null
    for ($attempt = 0; $attempt -lt 30 -and !$chain; $attempt++) {
        if ($forkProcess.HasExited) { throw 'The loopback Anvil process exited during startup.' }
        try { $chain = Invoke-LocalRpc 'eth_chainId' } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($chain -ne '0x7a69' -or @(Invoke-LocalRpc 'eth_accounts').Count -ne 0) {
        throw 'Expected an isolated chain 31337 fork with zero unlocked accounts.'
    }
    $anchor = Invoke-LocalRpc 'eth_getBlockByNumber' @(('0x' + ([long] $fork.block).ToString('x')), $false)
    if ($anchor.hash -cne $fork.blockHash) { throw 'The local fork does not match the approved Base Sepolia anchor.' }
    $manifest = Join-Path $scratch 'deployment.json'
    & $node (Join-Path $repo 'packages/contracts/scripts/validate-curve-graduation-4663.mjs') `
        --rpc $rpc --solc $solcPath --backing-wei 2000000000000000000 --owner-test > $manifest
    if ($LASTEXITCODE -ne 0) { throw 'The isolated curve fixture could not be deployed.' }
    $deployment = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($deployment.chainId -ne 31337 -or $deployment.terms.backingWei -ne '2000000000000000000' -or
        $deployment.creationFeeWei -ne '400000000000000') {
        throw 'The fixture did not confirm the 2 ETH graduation profile and 0.0004 ETH fee.'
    }
    if ((Invoke-LocalRpc 'eth_getCode' @($Wallet, 'latest')) -ne '0x' -or
        (Invoke-LocalRpc 'eth_getTransactionCount' @($Wallet, 'latest')) -ne '0x0' -or
        (Invoke-LocalRpc 'eth_getBalance' @($Wallet, 'latest')) -ne '0x0') {
        throw 'Use a fresh externally owned wallet with no activity or funds on the fork anchor.'
    }
    $null = Invoke-LocalRpc 'anvil_setBalance' @($Wallet, '0x8ac7230489e80000')
    $access = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $rpcCode = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $expires = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeSeconds()
    $runtime = @{
        RMT_CURVE_ENABLED = 'true'
        RMT_CURVE_RPC_URL = $rpc
        RMT_CURVE_DATABASE_PATH = Join-Path $scratch 'curve.sqlite'
        RMT_CURVE_FACTORY_ADDRESS = $deployment.factory
        RMT_CURVE_FACTORY_RUNTIME_HASH = $deployment.factoryRuntimeHash
        RMT_CURVE_GRADUATION_RUNTIME_HASH = $deployment.graduationRuntimeHash
        RMT_CURVE_GUARD_RUNTIME_HASH = $deployment.guardRuntimeHash
        RMT_CURVE_REGISTRY_RUNTIME_HASH = $deployment.registryRuntimeHash
        RMT_CURVE_START_BLOCK = [string] $deployment.deployBlock
        RMT_CURVE_GRADUATION_BACKING_WEI = '2000000000000000000'
        RMT_LAUNCHPAD_ENABLED = 'false'
        RMT_LAUNCHPAD_PREVIEW_ORIGIN = $origin
        RMT_LAUNCHPAD_PREVIEW_ACCESS_CODE = $access
        RMT_LAUNCHPAD_PREVIEW_RPC_CODE = $rpcCode
        RMT_LAUNCHPAD_PREVIEW_WALLET = $Wallet
        RMT_LAUNCHPAD_PREVIEW_EXPIRES_AT = [string] $expires
        RMT_LAUNCHPAD_PREVIEW_WEB_URL = $backend
        RMT_LAUNCHPAD_PREVIEW_BIND = $Address
        RMT_LAUNCHPAD_PREVIEW_PORT = [string] $GatewayPort
        RMT_LAUNCHPAD_PREVIEW_TLS_CERT = $tls.Certificate
        RMT_LAUNCHPAD_PREVIEW_TLS_KEY = $tls.PrivateKey
        RMT_LAUNCHPAD_PREVIEW_LAN_PEER = $PhoneAddress
    }
    $webProcess = Start-FixtureProcess $node @('node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', "$WebPort") $web 'next' $runtime
    $ready = $false
    for ($attempt = 0; $attempt -lt 25 -and !$ready; $attempt++) {
        if ($webProcess.HasExited) { throw 'The loopback web process exited during startup.' }
        try {
            $config = Invoke-RestMethod -Uri "${backend}api/launchpad/config" -TimeoutSec 5
            $ready = $config.status -eq 'ready' -and $config.deployment.chainId -eq 31337
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$ready) { throw 'The loopback web app did not verify the fixture.' }
    $gateway = Start-FixtureProcess $node @('--import', 'tsx', 'scripts/launchpad-preview-gateway.ts') $web 'gateway' $runtime
    $listening = $false
    $listenerLog = Join-Path $scratch 'gateway.log'
    for ($attempt = 0; $attempt -lt 30 -and !$listening; $attempt++) {
        if ($gateway.HasExited) { throw 'The private gateway rejected its configuration. Inspect its local diagnostic log.' }
        $listening = (Get-Content -LiteralPath $listenerLog -Raw) -match 'Private preview gateway listening'
        if (!$listening) { Start-Sleep -Milliseconds 500 }
    }
    if (!$listening) { throw 'The private gateway did not start.' }
    # Keep the two test credentials out of the console, process command line and shared evidence.
    $accessPath = Join-Path $scratch 'phone-access-code.txt'
    $walletRpcPath = Join-Path $scratch 'phone-wallet-rpc.txt'
    $access | Out-File -LiteralPath $accessPath -NoClobber -NoNewline -Encoding utf8
    "$origin/preview-rpc/$rpcCode" | Out-File -LiteralPath $walletRpcPath -NoClobber -NoNewline -Encoding utf8
    [pscustomobject] @{
        Url = $origin
        ExpiresAt = [DateTimeOffset]::FromUnixTimeSeconds($expires).ToLocalTime()
        IosProfile = $tls.IosProfile
        RootCertificate = $tls.RootCertificate
        RootFingerprint = $tls.RootFingerprint
        AccessCodeFile = $accessPath
        WalletRpcFile = $walletRpcPath
        Deployment = $manifest
        Database = $runtime.RMT_CURVE_DATABASE_PATH
        LocalAdminRpc = $rpc
    }
    while (!$gateway.HasExited -and !$webProcess.HasExited -and !$forkProcess.HasExited -and
        [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt $expires) {
        Start-Sleep -Seconds 2
    }
} finally {
    foreach ($process in $processes) {
        if (!$process.HasExited) { Stop-Process -InputObject $process -ErrorAction SilentlyContinue }
        $process.Dispose()
    }
    foreach ($name in @('phone-access-code.txt', 'phone-wallet-rpc.txt', 'server-key.pem')) {
        $sessionSecret = Join-Path $scratch $name
        if (Test-Path -LiteralPath $sessionSecret -PathType Leaf) { Remove-Item -LiteralPath $sessionSecret }
    }
}
