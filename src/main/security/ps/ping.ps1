# ICMP ping to several hosts at the same moment, for the Ping & Speed checker. Read-only.

$count = [int]$P.count; if ($count -lt 1) { $count = 20 }
$timeout = [int]$P.timeoutMs; if ($timeout -lt 200) { $timeout = 1000 }
$gap = [int]$P.intervalMs; if ($gap -lt 0) { $gap = 200 }

$targets = @()
foreach ($t in @($P.targets)) {
  $name = [string]$t.host
  $addr = $null
  if (-not [System.Net.IPAddress]::TryParse($name, [ref]$addr)) {
    try { $addr = @([System.Net.Dns]::GetHostAddresses($name) | Where-Object { $_.AddressFamily -eq 'InterNetwork' })[0] } catch { $addr = $null }
  }
  $targets += , ([ordered]@{ id = [string]$t.id; host = $name; ip = [string]$addr; samples = New-Object System.Collections.ArrayList })
}

for ($i = 0; $i -lt $count; $i++) {
  $jobs = @()
  foreach ($t in $targets) {
    if (-not $t.ip) { [void]$t.samples.Add(-1); continue }
    $pinger = New-Object System.Net.NetworkInformation.Ping
    $jobs += , @($t, $pinger.SendPingAsync($t.ip, $timeout))
  }
  foreach ($j in $jobs) {
    try {
      $reply = $j[1].GetAwaiter().GetResult()
      if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { [void]$j[0].samples.Add([int]$reply.RoundtripTime) }
      else { [void]$j[0].samples.Add(-1) }
    } catch { [void]$j[0].samples.Add(-1) }
  }
  if ($gap -gt 0) { Start-Sleep -Milliseconds $gap }
}

$R['results'] = @($targets | ForEach-Object { [ordered]@{ id = $_.id; host = $_.host; ip = $_.ip; samples = @($_.samples) } })
Out-Result
