# The ONLY script that changes the system. Every action is chosen by the app
# (never by page content), confirmed by the user first, and registry changes
# are exported to a .reg backup before they happen.

function Backup-Key([string]$RegKey) {
  if (-not $P.backupDir -or -not $RegKey) { return }
  New-Item -ItemType Directory -Force -Path $P.backupDir | Out-Null
  $safe = ($RegKey -replace '[^A-Za-z0-9._-]+', '_')
  if ($safe.Length -gt 80) { $safe = $safe.Substring($safe.Length - 80) }
  $file = Join-Path $P.backupDir ((Get-Date -Format 'yyyyMMdd-HHmmss') + '_' + $safe + '.reg')
  reg.exe export $RegKey $file /y 2>$null | Out-Null
}

function PsPath([string]$RegKey) {
  return ($RegKey -replace '^HKEY_LOCAL_MACHINE', 'HKLM:' -replace '^HKEY_CURRENT_USER', 'HKCU:' -replace '^HKLM\\', 'HKLM:\' -replace '^HKCU\\', 'HKCU:\')
}

function Done([string]$Message) { [ordered]@{ ok = $true; message = $Message } }

try {
  $result = switch ([string]$P.type) {
    'defender-scan' {
      if ($P.scanType -eq 'CustomScan') { Start-MpScan -ScanType CustomScan -ScanPath $P.path -ErrorAction Stop }
      else { Start-MpScan -ScanType $P.scanType -ErrorAction Stop }
      Done 'Scan finished.'
    }
    'defender-cancel' {
      $exe = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
      & $exe -Cancel 2>$null | Out-Null
      Done 'Scan cancelled.'
    }
    'defender-update' { Update-MpSignature -ErrorAction Stop; Done 'Virus definitions updated.' }
    'defender-remove' { Remove-MpThreat -ErrorAction Stop; Done 'Threats removed.' }
    'defender-offline' { Start-MpWDOScan -ErrorAction Stop; Done 'Your PC will restart to run the offline scan.' }
    'defender-exclusion-remove' {
      switch ([string]$P.kind) {
        'path' { Remove-MpPreference -ExclusionPath $P.value -ErrorAction Stop }
        'extension' { Remove-MpPreference -ExclusionExtension $P.value -ErrorAction Stop }
        'process' { Remove-MpPreference -ExclusionProcess $P.value -ErrorAction Stop }
      }
      Done 'Exclusion removed.'
    }
    'defender-pref' {
      switch ([string]$P.name) {
        'realtime' { Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop }
        'behavior' { Set-MpPreference -DisableBehaviorMonitoring $false -ErrorAction Stop }
        'ioav' { Set-MpPreference -DisableIOAVProtection $false -ErrorAction Stop }
        'script' { Set-MpPreference -DisableScriptScanning $false -ErrorAction Stop }
        'pua' { Set-MpPreference -PUAProtection Enabled -ErrorAction Stop }
        'maps' { Set-MpPreference -MAPSReporting Advanced -ErrorAction Stop }
      }
      Done 'Protection setting turned on.'
    }
    'firewall-on' { Set-NetFirewallProfile -Profile Domain, Public, Private -Enabled True -ErrorAction Stop; Done 'Firewall turned on.' }
    'rdp-off' {
      Backup-Key 'HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server'
      Set-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 1 -Type DWord -ErrorAction Stop
      Disable-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -ErrorAction SilentlyContinue
      Done 'Remote Desktop turned off.'
    }
    'ra-off' {
      Set-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Remote Assistance' -Name 'fAllowToGetHelp' -Value 0 -Type DWord -ErrorAction Stop
      Done 'Remote Assistance turned off.'
    }
    'remote-registry-off' {
      Stop-Service -Name RemoteRegistry -Force -ErrorAction SilentlyContinue
      Set-Service -Name RemoteRegistry -StartupType Disabled -ErrorAction Stop
      Done 'Remote Registry disabled.'
    }
    'smb1-off' { Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -ErrorAction Stop; Done 'SMBv1 turned off.' }
    'user-disable' {
      $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      if ($P.sid -eq $me) { throw 'Refusing to disable the account you are signed in with.' }
      Disable-LocalUser -SID $P.sid -ErrorAction Stop
      Done 'Account disabled.'
    }
    'reg-set' {
      Backup-Key $P.regKey
      $path = PsPath $P.regKey
      if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
      $value = $P.value
      if ($P.valueType -eq 'Binary') { $value = [byte[]]@($P.value | ForEach-Object { [byte]$_ }) }
      Set-ItemProperty -LiteralPath $path -Name $P.name -Value $value -Type $P.valueType -ErrorAction Stop
      Done 'Setting changed. A backup was saved.'
    }
    'reg-delete-value' {
      Backup-Key $P.regKey
      Remove-ItemProperty -LiteralPath (PsPath $P.regKey) -Name $P.name -ErrorAction Stop
      Done 'Entry removed. A backup was saved.'
    }
    'reg-delete-values' {
      Backup-Key $P.regKey
      foreach ($n in @($P.names)) { Remove-ItemProperty -LiteralPath (PsPath $P.regKey) -Name $n -ErrorAction Stop }
      Done 'Entries removed. A backup was saved.'
    }
    'reg-delete-key' {
      Backup-Key $P.regKey
      Remove-Item -LiteralPath (PsPath $P.regKey) -Recurse -Force -ErrorAction Stop
      Done 'Entry removed. A backup was saved.'
    }
    'kill-path' {
      $n = 0
      foreach ($pr in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -eq $P.path) })) { Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue; $n++ }
      Done ("Closed " + $n + " program(s).")
    }
    'kill-process' { Stop-Process -Id ([int]$P.pid) -Force -ErrorAction Stop; Done 'Program closed.' }
    'block-program' {
      $name = 'opKapot block - ' + [IO.Path]::GetFileName($P.path)
      $desc = 'Added by opKapot. Unblock it in opKapot > Network Monitor > Blocked.'
      New-NetFirewallRule -DisplayName $name -Group 'opKapot' -Description $desc -Direction Outbound -Program $P.path -Action Block -ErrorAction Stop | Out-Null
      New-NetFirewallRule -DisplayName $name -Group 'opKapot' -Description $desc -Direction Inbound -Program $P.path -Action Block -ErrorAction Stop | Out-Null
      Done 'Internet access blocked for this program. You can unblock it under Network Monitor > Blocked.'
    }
    'unblock-program' {
      $n = 0
      foreach ($ruleName in @($P.rules)) {
        $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
        # Only ever remove rules opKapot itself created.
        if ($rule -and ($rule.DisplayName -like 'opKapot block*' -or $rule.Group -eq 'opKapot')) { $rule | Remove-NetFirewallRule -ErrorAction Stop; $n++ }
      }
      if ($n -eq 0) { throw 'The block rule was already removed.' }
      Done 'Unblocked. The program can use the internet again.'
    }
    'task-disable' { Disable-ScheduledTask -TaskPath $P.taskPath -TaskName $P.taskName -ErrorAction Stop | Out-Null; Done 'Task disabled.' }
    'task-enable' { Enable-ScheduledTask -TaskPath $P.taskPath -TaskName $P.taskName -ErrorAction Stop | Out-Null; Done 'Task enabled.' }
    'service-disable' {
      Stop-Service -Name $P.service -Force -ErrorAction SilentlyContinue
      Set-Service -Name $P.service -StartupType Disabled -ErrorAction Stop
      Done 'Service stopped and disabled.'
    }
    'service-enable' { Set-Service -Name $P.service -StartupType Automatic -ErrorAction Stop; Done 'Service enabled.' }
    'wmi-remove' {
      $ns = 'root\subscription'
      Get-CimInstance -Namespace $ns -ClassName __FilterToConsumerBinding -ErrorAction SilentlyContinue |
        Where-Object { ([string]$_.Consumer -like ('*"' + $P.consumer + '"*')) } | Remove-CimInstance -ErrorAction SilentlyContinue
      Get-CimInstance -Namespace $ns -ClassName $P.consumerClass -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $P.consumer } | Remove-CimInstance -ErrorAction Stop
      Done 'Hidden WMI task removed.'
    }
    'guard-autostart' {
      $task = 'opKapot Guard'
      if ($P.enable) {
        $action = New-ScheduledTaskAction -Execute $P.exe -Argument '--background'
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
        Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force -ErrorAction Stop | Out-Null
        Done 'Protection will start with Windows.'
      } else {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
        Done 'Protection will no longer start with Windows.'
      }
    }
    # ------------------------------------------------------------ Game Mode ---
    'close-apps' {
      $sysRoot = [string]$env:SystemRoot
      $procs = @()
      foreach ($t in @($P.targets)) {
        $proc = Get-Process -Id ([int]$t.pid) -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $exe = [string]$proc.Path
        # Skip if the ID now belongs to a different program, or anything inside Windows.
        if (-not $exe -or $exe -ne [string]$t.path) { continue }
        if ($sysRoot -and $exe.StartsWith($sysRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $procs += $proc
      }
      foreach ($proc in $procs) { if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { try { [void]$proc.CloseMainWindow() } catch {} } }
      $deadline = (Get-Date).AddSeconds(4)
      while ((Get-Date) -lt $deadline -and @($procs | Where-Object { -not $_.HasExited }).Count -gt 0) {
        Start-Sleep -Milliseconds 250
        foreach ($proc in $procs) { try { $proc.Refresh() } catch {} }
      }
      foreach ($proc in $procs) { if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {} } }
      Start-Sleep -Milliseconds 400
      $closed = @($procs | Where-Object { -not (Get-Process -Id $_.Id -ErrorAction SilentlyContinue) } | ForEach-Object { [int]$_.Id })
      [ordered]@{ ok = $true; message = ('Closed ' + $closed.Count + ' program(s).'); data = [ordered]@{ closed = $closed } }
    }
    'services-stop' {
      $stopped = @()
      foreach ($n in @($P.names)) {
        $svc = Get-Service -Name ([string]$n) -ErrorAction SilentlyContinue
        if ($svc -and [string]$svc.Status -eq 'Running' -and $svc.CanStop) {
          try { Stop-Service -Name ([string]$n) -Force -NoWait -ErrorAction Stop; $stopped += [string]$n } catch {}
        }
      }
      [ordered]@{ ok = $true; message = ('Paused ' + $stopped.Count + ' service(s).'); data = [ordered]@{ stopped = $stopped } }
    }
    'services-start' {
      foreach ($n in @($P.names)) { try { Start-Service -Name ([string]$n) -ErrorAction Stop } catch {} }
      Done 'Services started again.'
    }
    'power-high' {
      $guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
      $prev = [regex]::Match([string](powercfg.exe /getactivescheme), $guid).Value
      $want = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
      $created = ''
      if ([string](powercfg.exe /list) -notmatch $want) {
        $dup = [regex]::Match([string](powercfg.exe /duplicatescheme $want), $guid)
        if (-not $dup.Success) { throw 'This PC has no High performance power plan (common on laptops with Modern Standby).' }
        $want = $dup.Value; $created = $dup.Value
      }
      powercfg.exe /setactive $want | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Windows refused to switch the power plan.' }
      [ordered]@{ ok = $true; message = 'High performance power plan on.'; data = [ordered]@{ previous = $prev; active = $want; created = $created } }
    }
    'power-restore' {
      $guid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      if ([string]$P.previous -match $guid) { powercfg.exe /setactive ([string]$P.previous) | Out-Null }
      if ([string]$P.created -match $guid -and [string]$P.created -ne [string]$P.previous) { powercfg.exe /delete ([string]$P.created) | Out-Null }
      Done 'Power plan restored.'
    }
    'priority-high' {
      $n = 0
      foreach ($id in @($P.pids)) {
        $proc = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
        if ($proc) { try { $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High; $n++ } catch {} }
      }
      Done ('Game set to high priority (' + $n + ' process).')
    }
    'reopen-apps' {
      $n = 0
      foreach ($exe in @($P.paths)) {
        if ($exe -and (Test-Path -LiteralPath ([string]$exe) -PathType Leaf)) {
          # Started through explorer.exe so the app runs as you, not as administrator.
          Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('"' + [string]$exe + '"') -ErrorAction SilentlyContinue
          $n++
          Start-Sleep -Milliseconds 300
        }
      }
      Done ('Reopened ' + $n + ' app(s).')
    }
    'dns-flush' {
      Clear-DnsClientCache -ErrorAction SilentlyContinue
      ipconfig.exe /flushdns | Out-Null
      Done 'DNS cache cleared.'
    }
    'net-reset' {
      netsh.exe winsock reset | Out-Null
      netsh.exe int ip reset | Out-Null
      Done 'Network settings reset. Restart your PC to finish.'
    }
    default { throw ('Unknown action: ' + $P.type) }
  }
  ConvertTo-Json -InputObject $result -Depth 6 -Compress
} catch {
  ConvertTo-Json -InputObject ([ordered]@{ ok = $false; message = [string]$_.Exception.Message }) -Compress
}
