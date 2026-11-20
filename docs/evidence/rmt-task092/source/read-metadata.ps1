param([Parameter(Mandatory=$true)][string]$OutputDirectory,[ValidateRange(0,3)][int]$StartIndex=0,[ValidateRange(0,3)][int]$EndIndex=3)
$ErrorActionPreference='Stop'
if($EndIndex -lt $StartIndex){throw 'Invalid bounded target range'}
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a fresh evidence directory'}
[void](New-Item -ItemType Directory -Path $OutputDirectory)
$targets=@(
 @{id='RMTLaunchCurveDeploymentV2';address='0xb65380aE9A452813c4e6b0fF391cfE34faE676A5'},
 @{id='RMTV4CurveInitializationGuardV1';address='0x998F3C0CE20cFF92655D495a159B1Ca37c162000'},
 @{id='RMTV4CurveGraduationV1';address='0x10e540536F10ed36E5fC6638638f1d862e552D32'},
 @{id='RMTLaunchCurveFactoryV2';address='0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3'}
)
$report=[ordered]@{schemaVersion=1;scope='TASK092_BOUNDED_TYPED_PUBLIC_SOURCE_METADATA';startedAt=[DateTime]::UtcNow.ToString('o');status='UNKNOWN';requests=@();startIndex=$StartIndex;requestLimit=($EndIndex-$StartIndex+1);retries=0;posts=0;signing=$false;broadcast=$false;productionConfigurationChanges=$false}
$reportPath=Join-Path $OutputDirectory 'metadata-observation.json'
function Save-Report{$report|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $reportPath -Encoding utf8NoBOM}
foreach($target in $targets[$StartIndex..$EndIndex]){
 $url='https://robinhoodchain.blockscout.com/api/v2/smart-contracts/'+$target.address
 $row=[ordered]@{id=$target.id;address=$target.address;url=$url;method='GET';requestedAt=[DateTime]::UtcNow.ToString('o');status='ATTEMPTING'}
 $report.requests+=@($row);Save-Report
 try{
  $res=Invoke-WebRequest -Uri $url -Method Get -MaximumRedirection 0 -TimeoutSec 30 -SkipHttpErrorCheck
  $text=[string]$res.Content;$bytes=[System.Text.Encoding]::UTF8.GetBytes($text)
  if($bytes.Length -gt 2097152){throw 'Response exceeds 2MiB bound'}
  $row.httpStatus=[int]$res.StatusCode;$row.contentType=[string]$res.Headers['Content-Type'];$row.bytes=$bytes.Length
  $row.responseSha256=[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  $row.finishedAt=[DateTime]::UtcNow.ToString('o')
  $fileName=$target.id+'.metadata.json.gz';$filePath=Join-Path $OutputDirectory $fileName
  $stream=[System.IO.File]::Create($filePath);try{$gzip=[System.IO.Compression.GZipStream]::new($stream,[System.IO.Compression.CompressionLevel]::Optimal);try{$gzip.Write($bytes,0,$bytes.Length)}finally{$gzip.Dispose()}}finally{$stream.Dispose()}
  $row.file=$fileName;$row.fileSha256=(Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant();Save-Report
  if($row.httpStatus -in @(401,403,429)){throw ('HTTP restriction '+$row.httpStatus+'; stop without retry')}
  if($row.httpStatus -ne 200){throw ('HTTP failure '+$row.httpStatus+'; stop without retry')}
  if($row.contentType -notmatch '(?i)^application/json'){throw 'Non-JSON content; stop without retry'}
  $data=$text|ConvertFrom-Json -Depth 100 -AsHashtable
  if($null -eq $data -or $data -is [array] -or $data.error -or ([string]$data.message -match '(?i)unauthorized|captcha|api.key.required|payment.required')){throw 'Top-level API error/challenge; stop without retry'}
  # Contract source and ABI may legitimately contain an Unauthorized error.
  # Their contents are never used to infer HTTP/account access restrictions.
  $row.isFullyVerified=$data.is_fully_verified;$row.isPartiallyVerified=$data.is_partially_verified
  $row.name=$data.name;$row.compilerVersion=$data.compiler_version;$row.verifiedAt=$data.verified_at
  $row.status='OBSERVED';Save-Report
 }catch{
  $row.status='UNAVAILABLE_NO_RETRY';$row.failure=$_.Exception.Message
  $report.status='STOPPED_AT_RESTRICTION_OR_FAILURE';$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Report
  [pscustomobject]@{status=$report.status;requests=$report.requests.Count;lastHttpStatus=$row.httpStatus;reason=$row.failure}|ConvertTo-Json
  exit 1
 }
}
$report.status='BOUNDED_PUBLIC_METADATA_OBSERVED';$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Report
[pscustomobject]@{status=$report.status;requests=$report.requests.Count;contracts=@($report.requests|ForEach-Object{[pscustomobject]$_}|Select-Object id,httpStatus,isFullyVerified,isPartiallyVerified,compilerVersion)}|ConvertTo-Json -Depth 5
