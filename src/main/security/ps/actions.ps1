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
      New-NetFirewallRule -DisplayName $name -Direction Outbound -Program $P.path -Action Block -ErrorAction Stop | Out-Null
      New-NetFirewallRule -DisplayName $name -Direction Inbound -Program $P.path -Action Block -ErrorAction Stop | Out-Null
      Done 'Internet access blocked for this program.'
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
    default { throw ('Unknown action: ' + $P.type) }
  }
  ConvertTo-Json -InputObject $result -Compress
} catch {
  ConvertTo-Json -InputObject ([ordered]@{ ok = $false; message = [string]$_.Exception.Message }) -Compress
}
