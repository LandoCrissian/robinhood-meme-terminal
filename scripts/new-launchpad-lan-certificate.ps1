[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $Address
)

$ErrorActionPreference = 'Stop'

$ip = [Net.IPAddress]::Parse($Address)
$bytes = $ip.GetAddressBytes()
$private = $ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and (
    $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
)
if (!$private -or $ip.ToString() -ne $Address) {
    throw 'Use the exact private IPv4 address of the Windows preview host.'
}

$privateInterfaces = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Private')
$attached = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' -and $_.InterfaceIndex -in $privateInterfaces.InterfaceIndex }
if (!$attached) {
    throw 'The address must belong to an active Windows Private network profile.'
}

$session = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$rootPath = Split-Path -Parent $PSScriptRoot
$out = Join-Path $rootPath ".launch-qa/iphone-tls-$session"
$issuerKey = [Security.Cryptography.RSA]::Create(2048)
$leafKey = [Security.Cryptography.RSA]::Create(2048)
$issuer = $null
$leaf = $null
try {
    $sha = [Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [Security.Cryptography.RSASignaturePadding]::Pkcs1
    $now = [DateTimeOffset]::UtcNow
    $starts = $now.AddMinutes(-5)
    $expires = $now.AddHours(4)

    $issuerRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        "CN=RMT Launch Preview CA $session", $issuerKey, $sha, $padding
    )
    $issuerRequest.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true)
    )
    $issuerRequest.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
            [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true
        )
    )
    $issuer = $issuerRequest.CreateSelfSigned($starts, $expires)

    $leafRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        "CN=RMT Launch Preview $session", $leafKey, $sha, $padding
    )
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress($ip)
    $leafRequest.CertificateExtensions.Add($san.Build())
    $leafRequest.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
    )
    $usage = [Security.Cryptography.X509Certificates.X509KeyUsageFlags]
    $leafRequest.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
            ($usage::DigitalSignature -bor $usage::KeyEncipherment), $true
        )
    )
    $extended = [Security.Cryptography.OidCollection]::new()
    [void] $extended.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $leafRequest.CertificateExtensions.Add(
        [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($extended, $false)
    )
    $serial = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $leaf = $leafRequest.Create($issuer, $starts, $expires, $serial)

    New-Item -ItemType Directory -Path $out | Out-Null
    $rootCertificate = Join-Path $out 'RMT-Preview-Root.cer'
    $iosProfile = Join-Path $out 'RMT-Launch-Preview.mobileconfig'
    $certificate = Join-Path $out 'server.pem'
    $privateKey = Join-Path $out 'server-key.pem'
    [IO.File]::WriteAllBytes($rootCertificate, $issuer.RawData)
    $rootData = [Convert]::ToBase64String($issuer.RawData)
    $profileId = [Guid]::NewGuid().ToString().ToUpperInvariant()
    $payloadId = [Guid]::NewGuid().ToString().ToUpperInvariant()
    $removalDate = $expires.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    [IO.File]::WriteAllText($iosProfile, @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadType</key><string>Configuration</string>
    <key>PayloadIdentifier</key><string>fun.rmtlaunch.preview.$session</string>
    <key>PayloadUUID</key><string>$profileId</string>
    <key>PayloadVersion</key><integer>1</integer>
    <key>PayloadDisplayName</key><string>RMT Launch Preview $session</string>
    <key>PayloadDescription</key><string>Temporary root certificate for the private RMT Launch test preview.</string>
    <key>RemovalDate</key><date>$removalDate</date>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key><string>com.apple.security.root</string>
            <key>PayloadIdentifier</key><string>fun.rmtlaunch.preview.$session.root</string>
            <key>PayloadUUID</key><string>$payloadId</string>
            <key>PayloadVersion</key><integer>1</integer>
            <key>PayloadDisplayName</key><string>RMT Launch Preview CA $session</string>
            <key>PayloadCertificateFileName</key><string>RMT-Preview-Root.cer</string>
            <key>PayloadContent</key><data>$rootData</data>
        </dict>
    </array>
</dict>
</plist>
"@)
    [IO.File]::WriteAllText($certificate, $leaf.ExportCertificatePem())
    [IO.File]::WriteAllText($privateKey, $leafKey.ExportPkcs8PrivateKeyPem())
    [pscustomobject] @{
        RootCertificate = $rootCertificate
        RootFingerprint = $issuer.GetCertHashString($sha)
        IosProfile = $iosProfile
        Certificate = $certificate
        PrivateKey = $privateKey
        ExpiresAt = $expires
    }
} finally {
    if ($leaf) { $leaf.Dispose() }
    if ($issuer) { $issuer.Dispose() }
    $leafKey.Dispose()
    $issuerKey.Dispose()
}
