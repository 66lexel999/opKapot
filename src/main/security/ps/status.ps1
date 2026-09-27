# Fast snapshot for the Security Center dashboard.

Section 'defender' {
  $s = Get-MpComputerStatus -ErrorAction Stop
  [ordered]@{
    serviceEnabled   = [bool]$s.AMServiceEnabled
    antivirusEnabled = [bool]$s.AntivirusEnabled
    realTime         = [bool]$s.RealTimeProtectionEnabled
    tamper           = [bool]$s.IsTamperProtected
    runningMode      = [string]$s.AMRunningMode
    signatureVersion = [string]$s.AntivirusSignatureVersion
    signatureUpdated = Ms $s.AntivirusSignatureLastUpdated
    quickScanEnd     = Ms $s.QuickScanEndTime
    fullScanEnd      = Ms $s.FullScanEndTime
  }
}

Section 'avProducts' {
  @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntivirusProduct -ErrorAction Stop | ForEach-Object {
    [ordered]@{ name = [string]$_.displayName; state = [int64]$_.productState; path = [string]$_.pathToSignedProductExe }
  })
}

Section 'firewallProducts' {
  @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName FirewallProduct -ErrorAction Stop | ForEach-Object {
    [ordered]@{ name = [string]$_.displayName; state = [int64]$_.productState }
  })
}

Section 'firewall' {
  @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; enabled = [string]$_.Enabled; inbound = [string]$_.DefaultInboundAction }
  })
}

Section 'rdp' {
  $ts = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
  [ordered]@{
    deny             = Get-RegValue $ts 'fDenyTSConnections'
    nla              = Get-RegValue "$ts\WinStations\RDP-Tcp" 'UserAuthentication'
    port             = Get-RegValue "$ts\WinStations\RDP-Tcp" 'PortNumber'
    remoteAssistance = Get-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Remote Assistance' 'fAllowToGetHelp'
  }
}

Section 'rdpSessions' { @((qwinsta 2>$null) | ForEach-Object { [string]$_ }) }

Section 'processes' {
  @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path; company = [string]$_.Company; description = [string]$_.Description }
  })
}

Section 'consent' {
  $out = New-Object System.Collections.ArrayList
  foreach ($cap in 'webcam', 'microphone', 'location') {
    $base = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\$cap"
    foreach ($k in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
      if ($k.PSChildName -eq 'NonPackaged') {
        foreach ($n in @(Get-ChildItem -LiteralPath $k.PSPath -ErrorAction SilentlyContinue)) {
          [void]$out.Add([ordered]@{ cap = $cap; packaged = $false; name = [string]$n.PSChildName; start = FileTimeMs $n.GetValue('LastUsedTimeStart'); stop = FileTimeMs $n.GetValue('LastUsedTimeStop') })
        }
      } else {
        [void]$out.Add([ordered]@{ cap = $cap; packaged = $true; name = [string]$k.PSChildName; start = FileTimeMs $k.GetValue('LastUsedTimeStart'); stop = FileTimeMs $k.GetValue('LastUsedTimeStop') })
      }
    }
  }
  @($out)
}

Out-Result
