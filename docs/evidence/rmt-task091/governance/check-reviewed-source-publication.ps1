param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a fresh result directory'}
[void](New-Item -ItemType Directory -Path $OutputDirectory)
$attempt=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current/source-publication-attempt.json') -Raw|ConvertFrom-Json
if($attempt.status -ne 'SOURCE_VERIFICATION_SUBMISSIONS_ACCEPTED_PENDING_CANONICAL_METADATA'){throw 'No accepted reviewed source-publication batch'}
$report=[ordered]@{schemaVersion=1;scope='TASK091_ONE_PASS_SOURCE_PUBLICATION_RESULTS';startedAt=[DateTime]::UtcNow.ToString('o');requests=@();status='UNKNOWN';requestLimit=8;retries=0;signing=$false;broadcast=$false;contractDeployment=$false;sourcePublicationPostAttempts=4}
$reportPath=Join-Path $OutputDirectory 'outcome.json'
function Save-Report{$report|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $reportPath -Encoding utf8}
function Digest([byte[]]$Bytes){[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()}
foreach($row in $attempt.requests){
 foreach($kind in @('legacy-job','canonical-metadata')){
  $uri=if($kind -eq 'legacy-job'){'https://robinhoodchain.blockscout.com/api?module=contract&action=checkverifystatus&guid='+[Uri]::EscapeDataString($row.apiResult)}else{'https://robinhoodchain.blockscout.com/api/v2/smart-contracts/'+$row.address}
  $r=[ordered]@{id=$row.id;address=$row.address;kind=$kind;requestedAt=[DateTime]::UtcNow.ToString('o');url=$uri;method='GET';status='ATTEMPTING'};$report.requests+=@($r);Save-Report
  try{
   $res=Invoke-WebRequest -Uri $uri -Method Get -MaximumRedirection 0 -TimeoutSec 30 -SkipHttpErrorCheck
   $text=[string]$res.Content;$bytes=[System.Text.Encoding]::UTF8.GetBytes($text);if($bytes.Length -gt 2097152){throw 'Response exceeds2MiB bound'}
   $r.httpStatus=[int]$res.StatusCode;$r.responseSha256=Digest $bytes;$r.responseBytes=$bytes.Length;$r.finishedAt=[DateTime]::UtcNow.ToString('o');$r.status='OBSERVED'
   if($kind -eq 'canonical-metadata'){
    $fileName=$row.id+'.metadata.json.gz';$filePath=Join-Path $OutputDirectory $fileName
    $stream=[System.IO.File]::Create($filePath);try{$gzip=[System.IO.Compression.GZipStream]::new($stream,[System.IO.Compression.CompressionLevel]::Optimal);try{$gzip.Write($bytes,0,$bytes.Length)}finally{$gzip.Dispose()}}finally{$stream.Dispose()}
    $r.file=$fileName;$r.fileSha256=(Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
   }else{$r.responseBody=$text}
   if($r.httpStatus -in @(401,403,429) -or $text -match '(?i)<title>[^<]*(captcha|access.denied)|payment.required|api.key.required|unauthorized'){throw 'Access or rate restriction; stop without retry'}
   if($r.httpStatus -ne 200){throw 'HTTP error; stop without retry'}
   $data=$text|ConvertFrom-Json
   if($kind -eq 'canonical-metadata'){$r.isFullyVerified=$data.is_fully_verified;$r.isPartiallyVerified=$data.is_partially_verified;$r.compilerVersion=$data.compiler_version;$r.verifiedAt=$data.verified_at;$r.contractName=$data.name}
   else{$r.apiStatus=$data.status;$r.apiResult=$data.result}
   Save-Report
  }catch{$r.status='UNAVAILABLE_NO_RETRY';$r.failure=$_.Exception.Message;$report.status='STOPPED_AT_RESTRICTION_OR_FAILURE';$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Report;[pscustomobject]@{status=$report.status;requests=$report.requests.Count;reason=$r.failure}|ConvertTo-Json;exit 1}
 }
}
$metadata=@($report.requests|Where-Object kind -EQ 'canonical-metadata')
$report.status=if(@($metadata|Where-Object isFullyVerified -EQ $true).Count -eq 4){'FOUR_FULL_EXPLORER_METADATA_OBSERVED_REQUIRES_SOURCE_RUNTIME_COMPARISON'}else{'SOURCE_PUBLICATION_NOT_FULLY_OBSERVED'}
$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Report
[pscustomobject]@{status=$report.status;requests=$report.requests.Count;metadata=@($metadata|Select-Object id,isFullyVerified,isPartiallyVerified,compilerVersion,contractName);legacyJobs=@($report.requests|Where-Object kind -EQ 'legacy-job'|Select-Object id,apiStatus,apiResult)}|ConvertTo-Json -Depth 6
