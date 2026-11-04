$ErrorActionPreference = 'Stop'
$s = Get-AuthenticodeSignature -LiteralPath $env:SLED_VERIFY_FILE
function CertificateInfo($certificate) {
    if ($null -eq $certificate) { return $null }
    return [ordered]@{
        subject = $certificate.Subject
        issuer = $certificate.Issuer
        thumbprint = $certificate.Thumbprint
        notBefore = $certificate.NotBefore.ToUniversalTime().ToString('o')
        notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
        signatureAlgorithm = $certificate.SignatureAlgorithm.Value
    }
}
$chainValid = $false
$chainStatus = @()
$chainElements = @()
if ($s.SignerCertificate) {
    $chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
        [void]$chain.ChainPolicy.ApplicationPolicy.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $chainValid = $chain.Build($s.SignerCertificate)
        $chainStatus = @($chain.ChainStatus | ForEach-Object { @{ status = $_.Status.ToString(); message = $_.StatusInformation.Trim() } })
        $chainElements = @($chain.ChainElements | ForEach-Object { CertificateInfo $_.Certificate })
    } finally { $chain.Dispose() }
}
$publisherMatches = $s.SignerCertificate -and ($s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ceq $env:SLED_WINDOWS_PUBLISHER_NAME)
$thumbprintMatches = $s.SignerCertificate -and (!$env:SLED_WINDOWS_SIGNER_THUMBPRINT -or $s.SignerCertificate.Thumbprint -ieq $env:SLED_WINDOWS_SIGNER_THUMBPRINT)
[ordered]@{
    file = [System.IO.Path]::GetFileName($env:SLED_VERIFY_FILE)
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:SLED_VERIFY_FILE).Hash
    status = $s.Status.ToString()
    statusMessage = $s.StatusMessage
    signatureType = $s.SignatureType.ToString()
    signer = (CertificateInfo $s.SignerCertificate)
    timestampSigner = (CertificateInfo $s.TimeStamperCertificate)
    publisherMatches = [bool]$publisherMatches
    thumbprintMatches = [bool]$thumbprintMatches
    chainValid = $chainValid
    chainStatus = $chainStatus
    chainElements = $chainElements
} | ConvertTo-Json -Depth 8
if ($s.Status -ne 'Valid' -or !$publisherMatches -or !$thumbprintMatches) { exit 1 }
