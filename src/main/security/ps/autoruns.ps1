# Everything that starts automatically: Run keys, Startup folders, scheduled tasks,
# third-party services and drivers, and WMI event subscriptions.

function Resolve-Lnk([string]$Path) {
  try {
    $sh = New-Object -ComObject WScript.Shell
    $l = $sh.CreateShortcut($Path)
    return [ordered]@{ target = [string]$l.TargetPath; args = [string]$l.Arguments }
  } catch { return $null }
}

Section 'run' {
  $keys = @(
    @('HKLM', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Run'),
    @('HKLM', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce', 'RunOnce'),
    @('HKLM', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'Run32'),
    @('HKLM', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce', 'RunOnce32'),
    @('HKCU', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Run'),
    @('HKCU', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce', 'RunOnce'),
    @('HKLM', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run', 'PolicyRun'),
    @('HKCU', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run', 'PolicyRun')
  )
  $entries = @(foreach ($k in $keys) {
    $vals = Get-RegValues $k[1]
    foreach ($n in @($vals.Keys)) {
      if ([string]::IsNullOrEmpty($n)) { continue }
      [ordered]@{ hive = $k[0]; key = $k[1]; kind = $k[2]; name = [string]$n; command = [string]$vals[$n] }
    }
  })
  $sa = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
  [ordered]@{
    entries  = $entries
    approved = [ordered]@{
      'HKCU\Run'           = Get-RegValues "HKCU:\$sa\Run"
      'HKLM\Run'           = Get-RegValues "HKLM:\$sa\Run"
      'HKLM\Run32'         = Get-RegValues "HKLM:\$sa\Run32"
      'HKCU\StartupFolder' = Get-RegValues "HKCU:\$sa\StartupFolder"
      'HKLM\StartupFolder' = Get-RegValues "HKLM:\$sa\StartupFolder"
    }
  }
}

Section 'startupFolder' {
  $dirs = @(@('HKCU', [Environment]::GetFolderPath('Startup')), @('HKLM', [Environment]::GetFolderPath('CommonStartup')))
  @(foreach ($d in $dirs) {
    if (-not $d[1]) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $d[1] -File -Force -ErrorAction SilentlyContinue)) {
      if ($f.Name -eq 'desktop.ini') { continue }
      $t = $null
      if ($f.Extension -eq '.lnk') { $t = Resolve-Lnk $f.FullName }
      [ordered]@{ hive = $d[0]; folder = $d[1]; path = $f.FullName; name = $f.Name; target = $t; modified = Ms $f.LastWriteTime }
    }
  })
}

Section 'tasks' {
  @(Get-ScheduledTask -ErrorAction Stop | ForEach-Object {
    $t = $_
    $acts = @($t.Actions | ForEach-Object { [ordered]@{ exe = [string]$_.Execute; args = [string]$_.Arguments; classId = [string]$_.ClassId } })
    $isMs = $t.TaskPath -like '\Microsoft\*'
    $keep = -not $isMs
    if ($isMs) {
      foreach ($a in $acts) {
        if ($a.exe -and ($a.exe -notmatch '(?i)^"?(%windir%|%systemroot%|c:\\windows\\|%programfiles%|%programfiles\(x86\)%|c:\\program files|%localappdata%\\microsoft\\|%programdata%\\microsoft\\|c:\\programdata\\microsoft\\)')) { $keep = $true }
      }
    }
    if ($keep) {
      [ordered]@{
        path = [string]$t.TaskPath; name = [string]$t.TaskName; state = [string]$t.State; author = [string]$t.Author
        runLevel = [string]$t.Principal.RunLevel; user = [string]$t.Principal.UserId; hidden = [bool]$t.Settings.Hidden
        actions = $acts; triggers = @($t.Triggers | ForEach-Object { [string]$_.CimClass.CimClassName })
      }
    }
  })
}

Section 'services' {
  @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { $_.PathName -and ($_.PathName -notmatch '(?i)^"?(c:\\windows\\|%systemroot%|\\systemroot\\)') } | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; display = [string]$_.DisplayName; path = [string]$_.PathName; start = [string]$_.StartMode; state = [string]$_.State; account = [string]$_.StartName; description = [string]$_.Description }
  })
}

Section 'drivers' {
  @(Get-CimInstance Win32_SystemDriver -ErrorAction Stop | Where-Object { $_.PathName -and ($_.PathName -notmatch '(?i)^(\\\?\?\\)?"?(c:\\windows\\system32\\drivers\\|\\systemroot\\system32\\drivers\\|c:\\windows\\system32\\driverstore\\|system32\\drivers\\)') } | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; display = [string]$_.DisplayName; path = [string]$_.PathName; start = [string]$_.StartMode; state = [string]$_.State }
  })
}

Section 'wmi' {
  $ns = 'root\subscription'
  [ordered]@{
    filters = @(Get-CimInstance -Namespace $ns -ClassName __EventFilter -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ name = [string]$_.Name; query = [string]$_.Query } })
    commandConsumers = @(Get-CimInstance -Namespace $ns -ClassName CommandLineEventConsumer -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ name = [string]$_.Name; command = [string]$_.CommandLineTemplate; exe = [string]$_.ExecutablePath } })
    scriptConsumers = @(Get-CimInstance -Namespace $ns -ClassName ActiveScriptEventConsumer -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ name = [string]$_.Name; engine = [string]$_.ScriptingEngine; text = [string]$_.ScriptText; file = [string]$_.ScriptFileName } })
    bindings = @(Get-CimInstance -Namespace $ns -ClassName __FilterToConsumerBinding -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ filter = [string]$_.Filter; consumer = [string]$_.Consumer } })
  }
}

Out-Result
