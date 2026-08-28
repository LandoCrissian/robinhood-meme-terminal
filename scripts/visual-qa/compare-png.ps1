param(
  [Parameter(Mandatory = $true)]
  [string]$Expected,

  [Parameter(Mandatory = $true)]
  [string]$Actual,

  [Parameter(Mandatory = $true)]
  [string]$Diff
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$expectedPath = [System.IO.Path]::GetFullPath($Expected)
$actualPath = [System.IO.Path]::GetFullPath($Actual)
$diffPath = [System.IO.Path]::GetFullPath($Diff)

if (-not [System.IO.File]::Exists($expectedPath)) {
  throw "Expected image does not exist: $expectedPath"
}

if (-not [System.IO.File]::Exists($actualPath)) {
  throw "Actual image does not exist: $actualPath"
}

$expectedBitmap = $null
$actualBitmap = $null
$diffBitmap = $null

try {
  $expectedBitmap = [System.Drawing.Bitmap]::FromFile($expectedPath)
  $actualBitmap = [System.Drawing.Bitmap]::FromFile($actualPath)

  if (($expectedBitmap.Width -ne $actualBitmap.Width) -or ($expectedBitmap.Height -ne $actualBitmap.Height)) {
    $diffWidth = [Math]::Max($expectedBitmap.Width, $actualBitmap.Width)
    $diffHeight = [Math]::Max($expectedBitmap.Height, $actualBitmap.Height)
    $diffBitmap = New-Object System.Drawing.Bitmap($diffWidth, $diffHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($diffBitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Magenta)
      $diffDirectory = [System.IO.Path]::GetDirectoryName($diffPath)
      [System.IO.Directory]::CreateDirectory($diffDirectory) | Out-Null
      $diffBitmap.Save($diffPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $graphics.Dispose()
    }
    $result = [ordered]@{
      equal = $false
      reason = "dimension-mismatch"
      expectedWidth = $expectedBitmap.Width
      expectedHeight = $expectedBitmap.Height
      actualWidth = $actualBitmap.Width
      actualHeight = $actualBitmap.Height
      differingPixels = $null
      totalPixels = $null
      tolerance = 0
    }
    $result | ConvertTo-Json -Compress
    exit 1
  }

  $width = $expectedBitmap.Width
  $height = $expectedBitmap.Height
  $rectangle = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
  $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $lockMode = [System.Drawing.Imaging.ImageLockMode]::ReadOnly
  $expectedData = $expectedBitmap.LockBits($rectangle, $lockMode, $pixelFormat)
  $actualData = $actualBitmap.LockBits($rectangle, $lockMode, $pixelFormat)

  try {
    $byteCount = [Math]::Abs($expectedData.Stride) * $height
    $expectedBytes = New-Object byte[] $byteCount
    $actualBytes = New-Object byte[] $byteCount
    [System.Runtime.InteropServices.Marshal]::Copy($expectedData.Scan0, $expectedBytes, 0, $byteCount)
    [System.Runtime.InteropServices.Marshal]::Copy($actualData.Scan0, $actualBytes, 0, $byteCount)
  }
  finally {
    $expectedBitmap.UnlockBits($expectedData)
    $actualBitmap.UnlockBits($actualData)
  }

  $differingPixels = 0L
  $diffBytes = New-Object byte[] $byteCount
  for ($offset = 0; $offset -lt $byteCount; $offset += 4) {
    $same = (
      $expectedBytes[$offset] -eq $actualBytes[$offset] -and
      $expectedBytes[$offset + 1] -eq $actualBytes[$offset + 1] -and
      $expectedBytes[$offset + 2] -eq $actualBytes[$offset + 2] -and
      $expectedBytes[$offset + 3] -eq $actualBytes[$offset + 3]
    )
    if ($same) {
      $diffBytes[$offset] = [byte]([int]($actualBytes[$offset] * 0.18))
      $diffBytes[$offset + 1] = [byte]([int]($actualBytes[$offset + 1] * 0.18))
      $diffBytes[$offset + 2] = [byte]([int]($actualBytes[$offset + 2] * 0.18))
      $diffBytes[$offset + 3] = 255
    }
    else {
      $differingPixels += 1
      $diffBytes[$offset] = 255
      $diffBytes[$offset + 1] = 0
      $diffBytes[$offset + 2] = 255
      $diffBytes[$offset + 3] = 255
    }
  }

  $totalPixels = [int64]$width * [int64]$height
  $equal = $differingPixels -eq 0

  if (-not $equal) {
    $diffBitmap = New-Object System.Drawing.Bitmap($width, $height, $pixelFormat)
    $diffData = $diffBitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $pixelFormat)
    try {
      [System.Runtime.InteropServices.Marshal]::Copy($diffBytes, 0, $diffData.Scan0, $byteCount)
    }
    finally {
      $diffBitmap.UnlockBits($diffData)
    }
    $diffDirectory = [System.IO.Path]::GetDirectoryName($diffPath)
    [System.IO.Directory]::CreateDirectory($diffDirectory) | Out-Null
    $diffBitmap.Save($diffPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }

  $result = [ordered]@{
    equal = $equal
    reason = if ($equal) { "exact-match" } else { "pixel-mismatch" }
    expectedWidth = $width
    expectedHeight = $height
    actualWidth = $width
    actualHeight = $height
    differingPixels = $differingPixels
    totalPixels = $totalPixels
    tolerance = 0
  }
  $result | ConvertTo-Json -Compress

  if (-not $equal) {
    exit 1
  }
}
finally {
  if ($null -ne $diffBitmap) { $diffBitmap.Dispose() }
  if ($null -ne $actualBitmap) { $actualBitmap.Dispose() }
  if ($null -ne $expectedBitmap) { $expectedBitmap.Dispose() }
}
