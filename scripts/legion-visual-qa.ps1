param(
  [switch]$UpdateBaselines,
  [switch]$SkipBuild,
  [switch]$CaptureOnly,
  [string]$BaselineRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$artifactParent = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".artifacts\legion-visual-qa"))
$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $artifactParent "latest"))
$actualRoot = Join-Path $artifactRoot "actual"
$diffRoot = Join-Path $artifactRoot "diff"
$defaultBaselineRoot = Join-Path $repoRoot "tests\visual\legion\baselines\windows"
$resolvedBaselineRoot = if ([string]::IsNullOrWhiteSpace($BaselineRoot)) {
  $defaultBaselineRoot
}
else {
  [System.IO.Path]::GetFullPath($BaselineRoot)
}

$stateNames = @(
  "token-scanner-desktop-1440x900",
  "token-asset-desktop-1440x900",
  "token-scanner-mobile-390x844",
  "token-asset-mobile-390x844",
  "nft-catalog-desktop-1440x900",
  "nft-project-desktop-1440x900",
  "nft-item-desktop-1440x900",
  "nft-catalog-mobile-390x844",
  "nft-project-mobile-390x844",
  "nft-item-mobile-390x844"
)

if ($UpdateBaselines -and $CaptureOnly) {
  throw "-UpdateBaselines and -CaptureOnly cannot be combined."
}

if ($UpdateBaselines -and ($resolvedBaselineRoot -ne [System.IO.Path]::GetFullPath($defaultBaselineRoot))) {
  throw "Baseline updates are restricted to the committed Windows baseline directory."
}

foreach ($command in @("node", "pnpm")) {
  if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required command is unavailable: $command"
  }
}

if (-not $artifactRoot.StartsWith($artifactParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clear artifact path outside the visual-QA artifact directory: $artifactRoot"
}

if (Test-Path -LiteralPath $artifactRoot) {
  Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
[System.IO.Directory]::CreateDirectory($actualRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($diffRoot) | Out-Null

Push-Location $repoRoot
$serverProcess = $null
$exitCode = 0
$gateEnvironment = @{
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED = "false"
  RMT_VNEXT_AUTHORIZATION_ENABLED = "false"
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED = "false"
}
$savedGateEnvironment = @{}
foreach ($entry in $gateEnvironment.GetEnumerator()) {
  $savedGateEnvironment[$entry.Key] = [System.Environment]::GetEnvironmentVariable($entry.Key, "Process")
  [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

try {
  $playwrightProbe = & node -e "require.resolve('playwright'); process.stdout.write('playwright-ready')"
  if ($LASTEXITCODE -ne 0) {
    throw "Repository Playwright dependency is unavailable. Run pnpm install --frozen-lockfile."
  }
  Write-Host $playwrightProbe

  & pnpm --filter web exec tsx "../../scripts/visual-qa/legion-token-fixture-authority-smoke.ts"
  if ($LASTEXITCODE -ne 0) {
    throw "Token fixture authority smoke failed."
  }
  $tokenFixtureAuthority = "PASS"

  & pnpm exec playwright install chromium
  if ($LASTEXITCODE -ne 0) {
    throw "Chromium installation/check failed."
  }

  if (-not $SkipBuild) {
    $savedNftMintClientFlag = [System.Environment]::GetEnvironmentVariable("NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED", "Process")
    [System.Environment]::SetEnvironmentVariable("NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED", "false", "Process")
    try {
      & pnpm build
      if ($LASTEXITCODE -ne 0) {
        throw "Production build failed."
      }
    }
    finally {
      [System.Environment]::SetEnvironmentVariable("NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED", $savedNftMintClientFlag, "Process")
    }
  }

  $serverStdout = Join-Path $artifactRoot "server.stdout.log"
  $serverStderr = Join-Path $artifactRoot "server.stderr.log"
  $serverEnvironment = @{
    NEXT_PUBLIC_RMT_NETWORK = "mainnet"
    RMT_VNEXT_SHELL_ENABLED = "true"
    NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED = "false"
    RMT_VNEXT_AUTHORIZATION_ENABLED = "false"
    NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED = "false"
    RMT_NFT_MINT_EXECUTION_ENABLED = "false"
    NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED = "false"
    NFT_INDEXER_URL = "http://127.0.0.1:43111"
    NFT_INDEXER_READ_TOKEN = ("a" * 64)
    NFT_MARKETPLACE_INDEXER_URL = "http://127.0.0.1:43111"
    NFT_MARKETPLACE_INDEXER_READ_TOKEN = ("a" * 64)
    NFT_MINT_RADAR_OPENSEA_API_KEY = "legion-radar-fixture"
    NFT_MINT_RADAR_OPENSEA_BASE_URL = "http://127.0.0.1:43111"
    NFT_MINT_RADAR_RPC_URL = "http://127.0.0.1:43111/rpc"
    NFT_MINT_RADAR_REVIEWED_SEADROP_DEPLOYMENTS = "0x5555555555555555555555555555555555555555@0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82"
  }

  $savedEnvironment = @{}
  foreach ($entry in $serverEnvironment.GetEnumerator()) {
    $savedEnvironment[$entry.Key] = [System.Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }

  try {
    $serverProcess = Start-Process `
      -FilePath (Get-Command node).Source `
      -ArgumentList @("node_modules/next/dist/bin/next", "start", "-p", "3111", "-H", "127.0.0.1") `
      -WorkingDirectory (Join-Path $repoRoot "apps/web") `
      -RedirectStandardOutput $serverStdout `
      -RedirectStandardError $serverStderr `
      -WindowStyle Hidden `
      -PassThru
  }
  finally {
    foreach ($entry in $savedEnvironment.GetEnumerator()) {
      [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
  }

  $serverReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if ($serverProcess.HasExited) {
      throw "Local RMT server exited before becoming ready. See $serverStderr"
    }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:3111/" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $serverReady = $true
        break
      }
    }
    catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $serverReady) {
    throw "Local RMT server did not become ready within 30 seconds. See $serverStderr"
  }

  & node "scripts/visual-qa/legion-visual-qa.mjs" "--base-url=http://127.0.0.1:3111" "--output=$actualRoot"
  if ($LASTEXITCODE -ne 0) {
    throw "Semantic/capture lane failed. See $actualRoot\semantic-summary.json"
  }

  $actualFiles = @(Get-ChildItem -LiteralPath $actualRoot -Filter "*.png" -File)
  if ($actualFiles.Count -ne $stateNames.Count) {
    throw "Expected $($stateNames.Count) screenshots but captured $($actualFiles.Count)."
  }

  if ($CaptureOnly) {
    Write-Host "Capture-only lane passed with $($actualFiles.Count) screenshots."
    exit 0
  }

  if ($UpdateBaselines) {
    [System.IO.Directory]::CreateDirectory($resolvedBaselineRoot) | Out-Null
    foreach ($stateName in $stateNames) {
      Copy-Item -LiteralPath (Join-Path $actualRoot "$stateName.png") -Destination (Join-Path $resolvedBaselineRoot "$stateName.png") -Force
    }
    Write-Host "Updated $($stateNames.Count) explicit Windows baselines at $resolvedBaselineRoot"
    exit 0
  }

  $comparisons = @()
  foreach ($stateName in $stateNames) {
    $expectedPath = Join-Path $resolvedBaselineRoot "$stateName.png"
    $actualPath = Join-Path $actualRoot "$stateName.png"
    $diffPath = Join-Path $diffRoot "$stateName.diff.png"

    $comparisonOutput = & pwsh -NoProfile -File "scripts/visual-qa/compare-png.ps1" -Expected $expectedPath -Actual $actualPath -Diff $diffPath
    $comparisonExitCode = $LASTEXITCODE
    $comparison = $comparisonOutput | ConvertFrom-Json
    $comparisons += [ordered]@{
      state = $stateName
      viewport = if ($stateName.Contains("mobile")) { "390x844" } else { "1440x900" }
      status = if ($comparisonExitCode -eq 0) { "PASS" } else { "FAIL" }
      reason = $comparison.reason
      differingPixels = $comparison.differingPixels
      totalPixels = $comparison.totalPixels
      expected = $expectedPath
      actual = $actualPath
      diff = if ($comparisonExitCode -eq 0) { $null } else { $diffPath }
    }
  }

  $failedComparisons = @($comparisons | Where-Object { $_.status -eq "FAIL" })
  $semanticSummary = Get-Content -LiteralPath (Join-Path $actualRoot "semantic-summary.json") -Raw | ConvertFrom-Json
  $report = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString("o")
    platform = "windows"
    comparisonTolerance = 0
    tokenFixtureAuthority = $tokenFixtureAuthority
    semantic = $semanticSummary
    visual = [ordered]@{
      status = if ($failedComparisons.Count -eq 0) { "PASS" } else { "FAIL" }
      unexpectedDiffs = $failedComparisons.Count
      states = $comparisons
    }
  }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $artifactRoot "report.json") -Encoding utf8

  $reportLines = @(
    "# RMT Legion Visual QA Report",
    "",
    "- Platform: Windows",
    "- Token fixture authority: $tokenFixtureAuthority",
    "- Semantic: $($semanticSummary.semantic.status)",
    "- Visual: $($report.visual.status)",
    "- Unexpected diffs: $($failedComparisons.Count)",
    "- Pixel tolerance: 0 (exact comparison)",
    "",
    "| State | Viewport | Result | Differing pixels |",
    "| --- | --- | --- | ---: |"
  )
  foreach ($comparison in $comparisons) {
    $reportLines += "| $($comparison.state) | $($comparison.viewport) | $($comparison.status) | $($comparison.differingPixels) |"
  }
  $reportLines | Set-Content -LiteralPath (Join-Path $artifactRoot "report.md") -Encoding utf8

  if ($failedComparisons.Count -gt 0) {
    Write-Host "Visual comparison failed for: $($failedComparisons.state -join ', ')"
    $exitCode = 1
  }
  else {
    Write-Host "Semantic PASS; visual PASS; unexpected diffs 0."
  }
}
catch {
  Write-Error $_
  $exitCode = 1
}
finally {
  if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
    $serverProcess.WaitForExit(10000) | Out-Null
  }
  foreach ($entry in $savedGateEnvironment.GetEnumerator()) {
    [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
  Pop-Location
}

exit $exitCode
