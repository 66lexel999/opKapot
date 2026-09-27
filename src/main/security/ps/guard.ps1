# Lightweight snapshot for the real-time Guard (runs every ~30 seconds).

Section 'consent' {
  $out = New-Object System.Collections.ArrayList
  foreach ($cap in 'webcam', 'microphone') {
    $base = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\$cap"
    foreach ($k in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
      $items = if ($k.PSChildName -eq 'NonPackaged') { @(Get-ChildItem -LiteralPath $k.PSPath -ErrorAction SilentlyContinue) } else { @($k) }
      foreach ($i in $items) {
        $start = [int64]$i.GetValue('LastUsedTimeStart', 0)
        $stop = [int64]$i.GetValue('LastUsedTimeStop', 0)
        if ($start -gt 0 -and $stop -eq 0) { [void]$out.Add([ordered]@{ cap = $cap; name = [string]$i.PSChildName; packaged = ($k.PSChildName -ne 'NonPackaged') }) }
      }
    }
  }
  @($out)
}

Section 'connections' {
  $procs = @{}
  foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) { $procs[[int]$p.Id] = $p }
  @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { ([string]$_.State -eq 'Listen') -or ([string]$_.State -eq 'Established') } | ForEach-Object {
    $p = $procs[[int]$_.OwningProcess]
    [ordered]@{
      state = [string]$_.State; localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort
      remoteAddress = [string]$_.RemoteAddress; remotePort = [int]$_.RemotePort; pid = [int]$_.OwningProcess
      name = [string]$p.ProcessName; path = [string]$p.Path
    }
  })
}

Section 'processes' { @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path } }) }

Section 'run' {
  @(foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce') {
    $v = Get-RegValues $k
    foreach ($n in @($v.Keys)) { if ($n) { [ordered]@{ key = $k; name = [string]$n; command = [string]$v[$n] } } }
  })
}

Section 'startupFolder' {
  @(foreach ($d in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) {
    if ($d) { Get-ChildItem -LiteralPath $d -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object { [string]$_.FullName } }
  })
}

Section 'tasks' {
  $tree = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree'
  @(Get-ChildItem -LiteralPath $tree -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.GetValue('Id') } | ForEach-Object {
    ([string]$_.Name) -replace '^.*\\TaskCache\\Tree', ''
  })
}

Section 'rdpSessions' { @((qwinsta 2>$null) | Where-Object { $_ -match 'rdp-tcp#' } | ForEach-Object { [string]$_ }) }

Section 'threatCount' { [int](@(Get-MpThreatDetection -ErrorAction Stop).Count) }

Out-Result
