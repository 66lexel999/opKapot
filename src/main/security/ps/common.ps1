# Shared helpers prepended to every opKapot security script.
# Scripts only READ system state unless they are actions.ps1.

function Ms($d) {
  if ($null -eq $d) { return $null }
  try { $dt = [datetime]$d } catch { return $null }
  if ($dt.Year -lt 1990) { return $null }
  return [int64]([DateTimeOffset]$dt).ToUnixTimeMilliseconds()
}

function FileTimeMs($v) {
  try {
    $n = [int64]$v
    if ($n -le 0) { return 0 }
    return Ms ([DateTime]::FromFileTimeUtc($n))
  } catch { return $null }
}

function Get-RegValue([string]$Path, [string]$Name) {
  try {
    $k = Get-Item -LiteralPath $Path -ErrorAction Stop
    return $k.GetValue($Name)
  } catch { return $null }
}

function Get-RegValues([string]$Path) {
  $o = [ordered]@{}
  try {
    $k = Get-Item -LiteralPath $Path -ErrorAction Stop
    foreach ($n in $k.GetValueNames()) {
      $v = $k.GetValue($n)
      if ($v -is [byte[]]) { $v = [Convert]::ToBase64String($v) }
      $o[[string]$n] = $v
    }
  } catch {}
  return $o
}

function Get-SubKeyNames([string]$Path) {
  try { return @(Get-ChildItem -LiteralPath $Path -ErrorAction Stop | ForEach-Object { [string]$_.PSChildName }) } catch { return @() }
}

$R = [ordered]@{}

function Section([string]$Name, [scriptblock]$Body) {
  try { $R[$Name] = & $Body }
  catch { $R[$Name] = [ordered]@{ error = [string]$_.Exception.Message } }
}

function Out-Result { ConvertTo-Json -InputObject $R -Depth 8 -Compress }
