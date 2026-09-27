# Live TCP/UDP sockets with their owning programs.

$procs = @{}
foreach ($proc in @(Get-Process -ErrorAction SilentlyContinue)) { $procs[[int]$proc.Id] = $proc }

Section 'tcp' {
  @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { ([string]$_.State -ne 'TimeWait') -and ([string]$_.State -ne 'Bound') } | ForEach-Object {
    [ordered]@{
      proto = 'TCP'; state = [string]$_.State; localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort
      remoteAddress = [string]$_.RemoteAddress; remotePort = [int]$_.RemotePort; pid = [int]$_.OwningProcess; created = Ms $_.CreationTime
    }
  })
}

Section 'udp' {
  @(Get-NetUDPEndpoint -ErrorAction Stop | ForEach-Object {
    [ordered]@{
      proto = 'UDP'; state = 'Listen'; localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort
      remoteAddress = ''; remotePort = 0; pid = [int]$_.OwningProcess; created = Ms $_.CreationTime
    }
  })
}

Section 'processes' {
  $ids = @(@($R['tcp']) + @($R['udp']) | Where-Object { $_ } | ForEach-Object { $_.pid } | Where-Object { $null -ne $_ } | Sort-Object -Unique)
  $info = [ordered]@{}
  foreach ($id in $ids) {
    $proc = $procs[[int]$id]
    if ($proc) { $info[[string]$id] = [ordered]@{ name = [string]$proc.ProcessName; path = [string]$proc.Path; company = [string]$proc.Company; description = [string]$proc.Description } }
  }
  $info
}

Section 'localIps' { @(Get-NetIPAddress -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.IPAddress }) }

Out-Result
