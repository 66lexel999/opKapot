# Digital-signature (Authenticode or catalog) status for a list of files in $P.paths.

$out = [ordered]@{}
foreach ($p in @($P.paths)) {
  if (-not $p) { continue }
  $key = [string]$p
  try {
    if (-not (Test-Path -LiteralPath $key -PathType Leaf)) { $out[$key] = [ordered]@{ exists = $false }; continue }
    $s = Get-AuthenticodeSignature -LiteralPath $key -ErrorAction Stop
    $signer = ''
    if ($s.SignerCertificate) { $signer = [string]$s.SignerCertificate.Subject }
    $company = ''
    try { $company = [string](Get-Item -LiteralPath $key -ErrorAction Stop).VersionInfo.CompanyName } catch {}
    $out[$key] = [ordered]@{ exists = $true; status = [string]$s.Status; signer = $signer; type = [string]$s.SignatureType; os = [bool]$s.IsOSBinary; company = $company }
  } catch {
    $out[$key] = [ordered]@{ exists = $true; status = 'Error'; signer = ''; error = [string]$_.Exception.Message }
  }
}
ConvertTo-Json -InputObject $out -Depth 4 -Compress
