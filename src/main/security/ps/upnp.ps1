# Port forwards the router has opened to this network via UPnP.

Section 'upnp' {
  $nat = New-Object -ComObject HNetCfg.NATUPnP
  $col = $nat.StaticPortMappingCollection
  if ($null -eq $col) { return [ordered]@{ available = $false; mappings = @() } }
  [ordered]@{
    available = $true
    mappings = @(foreach ($m in $col) {
      [ordered]@{
        external = [int]$m.ExternalPort; protocol = [string]$m.Protocol; internal = [int]$m.InternalPort
        client = [string]$m.InternalClient; enabled = [bool]$m.Enabled; description = [string]$m.Description; externalIp = [string]$m.ExternalIPAddress
      }
    })
  }
}

Out-Result
