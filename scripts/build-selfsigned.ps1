$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & "$PSScriptRoot\build.ps1"
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Subject -eq 'CN=MyBI Local Development' -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(1) } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MyBI Local Development' -FriendlyName 'MyBI local development code signing' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(1)
    }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    Export-Certificate -Cert $cert -FilePath "$root\artifacts\MyBI-Local-Development.cer" | Out-Null
    $exe = "$root\artifacts\MyBI-selfsigned.exe"
    Copy-Item -LiteralPath "$root\MyBI.exe" -Destination $exe -Force
    Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -HashAlgorithm SHA256 | Out-Null
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint -or $signature.Status -notin @('Valid', 'NotTrusted')) {
        throw "Signature verification failed: $($signature.Status) $($signature.StatusMessage)"
    }
    Copy-Item -LiteralPath $exe -Destination "$root\MyBI.exe" -Force
    if ((Get-FileHash -LiteralPath "$root\MyBI.exe").Hash -ne (Get-FileHash -LiteralPath $exe).Hash) { throw 'EXE copy verification failed.' }
    Write-Output "Created: $root\MyBI.exe"
    Write-Output "Signer: $($cert.Thumbprint); signature status: $($signature.Status)"
    Write-Output 'Self-signing does not establish publisher trust or guarantee endpoint security approval. No trust-store or antivirus settings were changed.'
}
finally { Pop-Location }
