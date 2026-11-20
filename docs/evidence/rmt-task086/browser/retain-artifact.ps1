param(
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][string]$MetadataPath,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [Parameter(Mandatory=$true)][string]$PlainRoot,
  [ValidateSet('default','none','desktop-call','portrait-cost')][string]$ScreenshotSet = 'default'
)
$ErrorActionPreference = 'Stop'
$meta = Get-Content -Raw -LiteralPath $MetadataPath | ConvertFrom-Json -AsHashtable
$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLowerInvariant()
if ($zipHash -ne $meta.zipSha256) { throw 'Artifact ZIP digest differs from GitHub source record' }
$names = @('task086-collection-acceptance.json','task086-real-collection-fork.json','native-order-admission-evidence.json','seaport-listing-watcher-evidence.json','seaport-safe-admin-evidence.json','seaport-browser-evidence.json','indexer-acceptance.json','worker-diagnostics.json','chain/seaport-acquisition-deployment.json','chain/seaport-acquisition-fixture-evidence.json')
if ($meta.mode -eq 'strict-security') { $names = @('seaport-acquisition-manifest.json','seaport-acquisition.json','seaport-acquisition-slither.json') }
elseif ($meta.conclusion -eq 'failure') { $names += @('failure.json','safe-network-cost-review.png','safe-two-owner-call-review.png','seaport-portrait.png') }
elseif ($ScreenshotSet -eq 'desktop-call') { $names += @('safe-admin-desktop.png','safe-two-owner-call-review.png') }
elseif ($ScreenshotSet -eq 'portrait-cost') { $names += @('safe-admin-portrait.png','safe-network-cost-review.png') }
elseif ($ScreenshotSet -eq 'default' -and $meta.mode.StartsWith('default-')) { $names += @('safe-admin-desktop.png','safe-admin-portrait.png','safe-admin-landscape.png','safe-network-cost-review.png','safe-two-owner-call-review.png') }
$archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
$members = @()
function Digest([byte[]]$b) { return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant() }
try {
  foreach ($name in $names) {
    $entry = $archive.GetEntry($name)
    if ($null -eq $entry) { throw "Missing selected member $name" }
    if ($entry.Length -gt 4000000) { throw 'Selected member exceeded evidence bound' }
    $stream = $entry.Open(); $memory = [System.IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $raw = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
    $relative = $meta.mode + '/' + $name
    if ($name.EndsWith('.png')) { $stored = $raw; $encoding = 'original PNG bytes' }
    else {
      $plain = Join-Path $PlainRoot $relative
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($plain)) | Out-Null
      [System.IO.File]::WriteAllBytes($plain,$raw)
      $relative += '.gz'; $encoding = 'gzip original UTF8 bytes'
      $compressed = [System.IO.MemoryStream]::new()
      $gzip = [System.IO.Compression.GzipStream]::new($compressed,[System.IO.Compression.CompressionLevel]::SmallestSize,$true)
      try { $gzip.Write($raw,0,$raw.Length) } finally { $gzip.Dispose() }
      $stored = $compressed.ToArray(); $compressed.Dispose()
    }
    $target = Join-Path $OutputRoot $relative
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    [System.IO.File]::WriteAllBytes($target,$stored)
    $members += @{ originalMember=$name; path=$relative; rawSha256=(Digest $raw); rawBytes=$raw.Length; storedSha256=(Digest $stored); storedBytes=$stored.Length; encoding=$encoding }
  }
} finally { $archive.Dispose() }
$meta.members=$members
[System.IO.File]::WriteAllText((Join-Path $OutputRoot ($meta.mode + '/artifact-manifest.json')),($meta | ConvertTo-Json -Depth 12)+"`n",[System.Text.UTF8Encoding]::new($false))
@{ mode=$meta.mode; conclusion=$meta.conclusion; members=$members.Count; zipSha256=$zipHash } | ConvertTo-Json -Compress
