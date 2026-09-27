# Network details for the Ping & Speed checker. Read-only.

Section 'adapters' {
  @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name; description = [string]$_.InterfaceDescription; index = [int]$_.ifIndex
      media = [string]$_.PhysicalMediaType; medium = [string]$_.NdisPhysicalMedium
      linkSpeed = [string]$_.LinkSpeed; receiveBps = [int64]$_.ReceiveLinkSpeed
      virtual = [bool]$_.Virtual; hardware = [bool]$_.HardwareInterface
    }
  })
}

Section 'defaultRoutes' {
  @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | ForEach-Object {
    [ordered]@{ index = [int]$_.ifIndex; nextHop = [string]$_.NextHop; metric = [int]$_.RouteMetric + [int]$_.InterfaceMetric; alias = [string]$_.InterfaceAlias }
  })
}

Section 'dns' {
  @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.ServerAddresses } | ForEach-Object {
    [ordered]@{ index = [int]$_.InterfaceIndex; servers = @($_.ServerAddresses | ForEach-Object { [string]$_ }) }
  })
}

Section 'wifi' { @(netsh.exe wlan show interfaces 2>$null | ForEach-Object { [string]$_ }) }

# Traffic over two seconds, to spot something downloading before the test.
Section 'traffic' {
  $before = @{}
  foreach ($s in @(Get-NetAdapterStatistics -ErrorAction Stop)) { $before[[string]$s.Name] = $s }
  Start-Sleep -Milliseconds 2000
  @(foreach ($s in @(Get-NetAdapterStatistics -ErrorAction Stop)) {
    $o = $before[[string]$s.Name]
    if ($o) { [ordered]@{ name = [string]$s.Name; rxBps = [int64](($s.ReceivedBytes - $o.ReceivedBytes) * 4); txBps = [int64](($s.SentBytes - $o.SentBytes) * 4) } }
  })
}

Section 'processes' {
  @(Get-Process -ErrorAction Stop | ForEach-Object { [ordered]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path } })
}

Section 'services' {
  @(Get-Service -Name 'wuauserv', 'BITS', 'DoSvc', 'UsoSvc' -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ name = [string]$_.Name; status = [string]$_.Status } })
}

Section 'downloads' {
  @(Get-DeliveryOptimizationStatus -ErrorAction Stop | Where-Object { $_.Status -match 'Download' } | ForEach-Object {
    [ordered]@{ file = [string]$_.FileId; status = [string]$_.Status; size = [int64]$_.FileSize }
  })
}

Section 'connections' {
  @(Get-NetTCPConnection -State Established -ErrorAction Stop | ForEach-Object {
    [ordered]@{ pid = [int]$_.OwningProcess; remoteAddress = [string]$_.RemoteAddress; remotePort = [int]$_.RemotePort }
  })
}

Out-Result
