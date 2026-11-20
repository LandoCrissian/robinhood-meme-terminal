param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Use a fresh attempt path; this producer never retries'}
function Sha([byte[]]$b){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant()}
$requestPath=Join-Path $PSScriptRoot '../../rmt-task091/governance/source-publication/RMTLaunchCurveDeploymentV2.request.json.gz'
$stream=[IO.File]::OpenRead($requestPath)
try{$gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionMode]::Decompress);$reader=[IO.StreamReader]::new($gzip);$p=$reader.ReadToEnd()|ConvertFrom-Json -Depth 100}finally{if($reader){$reader.Dispose()};if($gzip){$gzip.Dispose()};$stream.Dispose()}
if($p.address -cne '0xb65380aE9A452813c4e6b0fF391cfE34faE676A5' -or $p.id -ne 'RMTLaunchCurveDeploymentV2'){throw 'Exact canonical bootstrap target required'}
$sourceBytes=[Text.Encoding]::UTF8.GetBytes($p.fields.sourceCode)
if((Sha $sourceBytes) -ne '66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10'){throw 'Canonical compiler input differs'}
if($p.fields.constructorArguments -ne $p.constructorArguments.Substring(2) -or $p.fields.constructorArguments.Length -ne 832){throw 'Original416byte constructor required'}
$fields=[ordered]@{compiler_version=$p.fields.compilerversion;contract_name=$p.id;autodetect_constructor_args='false';constructor_args=$p.fields.constructorArguments;license_type='mit'}
$boundary='----RMTTask092CanonicalBootstrapV2'
$multipart=[Text.StringBuilder]::new()
foreach($field in $fields.GetEnumerator()){[void]$multipart.Append('--'+$boundary+"`r`n"+'Content-Disposition: form-data; name="'+$field.Key+'"'+"`r`n`r`n"+[string]$field.Value+"`r`n")}
[void]$multipart.Append('--'+$boundary+"`r`n"+'Content-Disposition: form-data; name="files[0]"; filename="solc-standard-input-4663.json"'+"`r`n"+'Content-Type: application/json'+"`r`n`r`n"+$p.fields.sourceCode+"`r`n"+'--'+$boundary+'--'+"`r`n")
$body=[Text.Encoding]::UTF8.GetBytes($multipart.ToString())
$record=[ordered]@{schemaVersion=1;scope='TASK092_ONE_NORMAL_EXISTING_BOOTSTRAP_SOURCE_VERIFICATION';startedAt=[DateTime]::UtcNow.ToString('o');url=('https://robinhoodchain.blockscout.com/api/v2/smart-contracts/'+$p.address+'/verification/via/standard-input');method='POST';fields=$fields;uploadField='files[0]';compilerInputSha256=(Sha $sourceBytes);multipartBodySha256=(Sha $body);bodyBytes=$body.Length;runtimeHash=$p.runtimeHash;initcodeHash=$p.initcodeHash;status='ATTEMPTING';attemptLimit=1;retries=0;apiKeyUsed=$false;signing=$false;broadcast=$false;contractDeployment=$false;tokenCreation=$false;sourceReference='https://github.com/blockscout/blockscout/blob/master/apps/block_scout_web/lib/block_scout_web/controllers/api/v2/verification_controller.ex#L125'}
function Save{$record|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM}
Save
try{
 $res=Invoke-WebRequest -Uri $record.url -Method Post -Body $body -ContentType ('multipart/form-data; boundary='+$boundary) -Headers @{Accept='application/json'} -MaximumRedirection 0 -TimeoutSec 30 -SkipHttpErrorCheck
 $text=[string]$res.Content;$record.httpStatus=[int]$res.StatusCode;$record.contentType=[string]$res.Headers['Content-Type'];$record.responseSha256=Sha ([Text.Encoding]::UTF8.GetBytes($text))
 if([Text.Encoding]::UTF8.GetByteCount($text) -gt 131072){throw 'Excessive response'}
 $record.responseBody=$text
 if($record.httpStatus -in @(401,403,429)){$record.status='STOPPED_AUTH_ACCESS_OR_RATE_RESTRICTION'}
 elseif($record.httpStatus -lt 200 -or $record.httpStatus -ge 300){$record.status='STOPPED_HTTP_FAILURE'}
 else{$json=$text|ConvertFrom-Json -AsHashtable -Depth 100;if($json.message -match '(?i)captcha|unauthorized|access denied|api.key|payment'){$record.status='STOPPED_AUTH_ACCESS_OR_RATE_RESTRICTION'}else{$record.status='SUBMITTED_METADATA_STILL_REQUIRES_FULL_SOURCE_MATCH'}}
}catch{$record.status='STOPPED_FAILURE_NO_RETRY';$record.failure=$_.Exception.Message}
$record.finishedAt=[DateTime]::UtcNow.ToString('o');Save
[pscustomobject]@{status=$record.status;httpStatus=$record.httpStatus;responseBody=$record.responseBody;output=$OutputPath}|ConvertTo-Json
