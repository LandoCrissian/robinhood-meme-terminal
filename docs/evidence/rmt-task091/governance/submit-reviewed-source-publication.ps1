param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$publicationDirectory = Join-Path $PSScriptRoot 'source-publication'
if (Test-Path -LiteralPath $OutputPath) { throw 'Use a fresh attempt-record path' }
$manifest = Get-Content -LiteralPath (Join-Path $publicationDirectory 'manifest.json') -Raw | ConvertFrom-Json
$record = [ordered]@{ schemaVersion=1; scope='TASK091_ROOT_REVIEWED_EXISTING_CONTRACT_SOURCE_PUBLICATION'; startedAt=[DateTime]::UtcNow.ToString('o'); status='NOT_ATTEMPTED'; requests=@(); signing=$false; broadcast=$false; contractDeployment=$false; apiKeyUsed=$false; networkAttemptLimit=4; retries=0; client='PowerShell Invoke-WebRequest normal per-instance multipart form'; approval='Task091 owner authority and root concrete four-payload review; source metadata only' }
function Save-Record { $record | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputPath -Encoding utf8 }
function Read-GzipJson([string]$Path) {
 $inputStream=[System.IO.File]::OpenRead($Path)
 try { $gzip=[System.IO.Compression.GZipStream]::new($inputStream,[System.IO.Compression.CompressionMode]::Decompress)
  try { $reader=[System.IO.StreamReader]::new($gzip,[System.Text.Encoding]::UTF8); try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } }
  finally { $gzip.Dispose() }
 } finally { $inputStream.Dispose() }
}
function Sha256([byte[]]$Bytes) { return [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant() }
Save-Record
foreach ($spec in $manifest.requests) {
 $requestFile=Join-Path $publicationDirectory ($spec.id+'.request.json.gz')
 $expected=($manifest.files | Where-Object path -EQ ($spec.id+'.request.json.gz')).sha256
 if ((Get-FileHash -LiteralPath $requestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Prepared request digest mismatch' }
 $payload=Read-GzipJson $requestFile
 if ($payload.transport.url -ne 'https://robinhoodchain.blockscout.com/api?module=contract&action=verifysourcecode' -or $payload.transport.method -ne 'POST') { throw 'Unreviewed request route' }
 if ((Sha256 ([System.Text.Encoding]::UTF8.GetBytes($payload.fields.sourceCode))) -ne $manifest.compilerInputSha256) { throw 'Compiler input changed' }
 if ($payload.address -ne $spec.address -or $payload.constructorArguments -ne $spec.constructorArguments -or $payload.runtimeHash -ne $spec.runtimeHash) { throw 'Target constructor or runtime changed' }
 $boundary='----RMTTask091SourcePublication'+$expected.Substring(0,24)
 $multipart=[System.Text.StringBuilder]::new()
 foreach($field in $payload.fields.PSObject.Properties) {
  if($field.Name -notin @('contractaddress','contractname','codeformat','compilerversion','sourceCode','constructorArguments','autodetectConstructorArguments','licenseType')) { throw 'Unreviewed form field' }
  [void]$multipart.Append('--'+$boundary+"`r`n"+'Content-Disposition: form-data; name="'+$field.Name+'"'+"`r`n`r`n"+[string]$field.Value+"`r`n")
 }
 [void]$multipart.Append('--'+$boundary+'--'+"`r`n")
 $body=[System.Text.Encoding]::UTF8.GetBytes($multipart.ToString())
 $row=[ordered]@{id=$spec.id; address=$spec.address; requestedAt=[DateTime]::UtcNow.ToString('o'); method='POST'; url=$payload.transport.url; payloadGzipSha256=$expected; multipartBodySha256=(Sha256 $body); bodyBytes=$body.Length; compilerInputSha256=$manifest.compilerInputSha256; constructorArguments=$spec.constructorArguments; runtimeHash=$spec.runtimeHash; status='ATTEMPTING'}
 $record.requests+=@($row);Save-Record
 try {
  $response=Invoke-WebRequest -Uri $payload.transport.url -Method Post -Body $body -ContentType ('multipart/form-data; boundary='+$boundary) -TimeoutSec 30 -MaximumRedirection 0 -SkipHttpErrorCheck
  $text=[string]$response.Content
  if([System.Text.Encoding]::UTF8.GetByteCount($text) -gt 131072) { throw 'Response exceeds bounded size' }
  $row.httpStatus=[int]$response.StatusCode; $row.responseBody=$text; $row.responseBodySha256=Sha256 ([System.Text.Encoding]::UTF8.GetBytes($text)); $row.status='HTTP_RESPONSE'; $row.finishedAt=[DateTime]::UtcNow.ToString('o')
  try { $parsed=$text|ConvertFrom-Json; $row.apiStatus=$parsed.status; $row.apiMessage=$parsed.message; $row.apiResult=$parsed.result } catch { $row.apiStatus='NON_JSON' }
  if($row.httpStatus -in @(401,403,429) -or $text -match '(?i)captcha|cloudflare|payment.required|api.key.required|unauthorized|access.denied') { $record.status='STOPPED_ACCESS_OR_RATE_LIMIT';Save-Record;break }
  if($row.httpStatus -lt 200 -or $row.httpStatus -ge 300) { $record.status='STOPPED_HTTP_ERROR';Save-Record;break }
  if($row.apiStatus -ne '1') { $record.status='STOPPED_VERIFICATION_NOT_ACCEPTED';Save-Record;break }
  $record.status='SOURCE_VERIFICATION_SUBMISSIONS_ACCEPTED_PENDING_CANONICAL_METADATA';Save-Record
 } catch { $row.status='UNAVAILABLE_NO_RETRY';$row.failure=$_.Exception.Message;$row.finishedAt=[DateTime]::UtcNow.ToString('o');$record.status='STOPPED_REQUEST_FAILURE';Save-Record;break }
}
$record.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Record
[pscustomobject]@{status=$record.status; attempts=$record.requests.Count; observations=@($record.requests|ForEach-Object{[pscustomobject]@{id=$_.id;httpStatus=$_.httpStatus;status=$_.status;apiStatus=$_.apiStatus;apiResult=$_.apiResult}})}|ConvertTo-Json -Depth 6
