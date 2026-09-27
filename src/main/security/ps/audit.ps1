# Deep "Hack Check" collector. Read-only: gathers raw facts, the app decides what is risky.

Section 'os' {
  $o = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
  $lastUpdate = $null
  try { $lastUpdate = Ms ((New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastInstallationSuccessDate) } catch {}
  $secureBoot = $null
  try { $secureBoot = [bool](Confirm-SecureBootUEFI -ErrorAction Stop) } catch {}
  [ordered]@{
    caption    = [string]$o.Caption
    version    = [string]$o.Version
    build      = [string]$o.BuildNumber
    lastBoot   = Ms $o.LastBootUpTime
    domain     = [bool]$cs.PartOfDomain
    computer   = [string]$env:COMPUTERNAME
    user       = [string]$env:USERNAME
    userSid    = [string]([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    lastUpdate = $lastUpdate
    secureBoot = $secureBoot
    bcd        = @((bcdedit /enum '{current}' 2>$null) | ForEach-Object { [string]$_ })
  }
}

Section 'processes' {
  @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path; company = [string]$_.Company; description = [string]$_.Description }
  })
}

Section 'programs' {
  @(foreach ($base in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
    foreach ($k in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
      $n = $k.GetValue('DisplayName')
      if ($n) { [ordered]@{ name = [string]$n; publisher = [string]$k.GetValue('Publisher'); location = [string]$k.GetValue('InstallLocation') } }
    }
  })
}

Section 'defender' {
  $s = Get-MpComputerStatus -ErrorAction Stop
  $mp = Get-MpPreference -ErrorAction SilentlyContinue
  [ordered]@{
    serviceEnabled     = [bool]$s.AMServiceEnabled
    antivirusEnabled   = [bool]$s.AntivirusEnabled
    realTime           = [bool]$s.RealTimeProtectionEnabled
    behavior           = [bool]$s.BehaviorMonitorEnabled
    ioav               = [bool]$s.IoavProtectionEnabled
    tamper             = [bool]$s.IsTamperProtected
    runningMode        = [string]$s.AMRunningMode
    signatureVersion   = [string]$s.AntivirusSignatureVersion
    signatureUpdated   = Ms $s.AntivirusSignatureLastUpdated
    quickScanEnd       = Ms $s.QuickScanEndTime
    fullScanEnd        = Ms $s.FullScanEndTime
    exclusionPath      = @($mp.ExclusionPath | Where-Object { $_ } | ForEach-Object { [string]$_ })
    exclusionExtension = @($mp.ExclusionExtension | Where-Object { $_ } | ForEach-Object { [string]$_ })
    exclusionProcess   = @($mp.ExclusionProcess | Where-Object { $_ } | ForEach-Object { [string]$_ })
    disableRealtime    = [bool]$mp.DisableRealtimeMonitoring
    disableBehavior    = [bool]$mp.DisableBehaviorMonitoring
    disableIoav        = [bool]$mp.DisableIOAVProtection
    disableScript      = [bool]$mp.DisableScriptScanning
    pua                = [int]$mp.PUAProtection
    cfa                = [int]$mp.EnableControlledFolderAccess
    maps               = [int]$mp.MAPSReporting
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

Section 'firewallRules' {
  $v = Get-RegValues 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules'
  @($v.Values | Where-Object { ($_ -is [string]) -and ($_ -match '\|Action=Allow\|') -and ($_ -match '\|Active=TRUE\|') -and ($_ -match '\|Dir=In\|') })
}

Section 'rdp' {
  $ts = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
  [ordered]@{
    deny             = Get-RegValue $ts 'fDenyTSConnections'
    nla              = Get-RegValue "$ts\WinStations\RDP-Tcp" 'UserAuthentication'
    port             = Get-RegValue "$ts\WinStations\RDP-Tcp" 'PortNumber'
    remoteAssistance = Get-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Remote Assistance' 'fAllowToGetHelp'
    sessions         = @((qwinsta 2>$null) | ForEach-Object { [string]$_ })
  }
}

Section 'accounts' {
  $admins = @()
  try {
    $admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | ForEach-Object {
      [ordered]@{ name = [string]$_.Name; sid = [string]$_.SID; source = [string]$_.PrincipalSource; type = [string]$_.ObjectClass }
    })
  } catch {
    try {
      $g = Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop
      $grp = [ADSI]("WinNT://./" + $g.Name + ",group")
      $admins = @($grp.psbase.Invoke('Members') | ForEach-Object {
        [ordered]@{ name = [string]$_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null); sid = ''; source = ''; type = '' }
      })
    } catch {}
  }
  $users = @(Get-LocalUser -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name; enabled = [bool]$_.Enabled; sid = [string]$_.SID
      lastLogon = Ms $_.LastLogon; passwordRequired = [bool]$_.PasswordRequired
      passwordLastSet = Ms $_.PasswordLastSet; description = [string]$_.Description
    }
  })
  [ordered]@{ users = $users; admins = $admins }
}

function EventData($e) {
  $d = @{}
  try {
    $x = [xml]$e.ToXml()
    foreach ($n in @($x.Event.EventData.Data)) { if ($n.Name) { $d[[string]$n.Name] = [string]$n.'#text' } }
  } catch {}
  return $d
}

Section 'logons' {
  $window = 14 * 86400000
  $success = @(Get-WinEvent -LogName Security -MaxEvents 300 -ErrorAction SilentlyContinue -FilterXPath "*[System[(EventID=4624) and TimeCreated[timediff(@SystemTime) <= $window]] and EventData[Data[@Name='LogonType']='10' or Data[@Name='LogonType']='3']]" | ForEach-Object {
    $d = EventData $_
    [ordered]@{ time = Ms $_.TimeCreated; type = $d['LogonType']; user = $d['TargetUserName']; domain = $d['TargetDomainName']; ip = $d['IpAddress']; workstation = $d['WorkstationName'] }
  })
  $failed = @(Get-WinEvent -LogName Security -MaxEvents 500 -ErrorAction SilentlyContinue -FilterXPath "*[System[(EventID=4625) and TimeCreated[timediff(@SystemTime) <= $window]]]" | ForEach-Object {
    $d = EventData $_
    [ordered]@{ time = Ms $_.TimeCreated; type = $d['LogonType']; user = $d['TargetUserName']; ip = $d['IpAddress']; workstation = $d['WorkstationName'] }
  })
  $changes = @(Get-WinEvent -LogName Security -MaxEvents 50 -ErrorAction SilentlyContinue -FilterXPath "*[System[(EventID=4720 or EventID=4732) and TimeCreated[timediff(@SystemTime) <= 2592000000]]]" | ForEach-Object {
    $d = EventData $_
    [ordered]@{ time = Ms $_.TimeCreated; id = [int]$_.Id; target = $d['TargetUserName']; targetSid = $d['TargetSid']; member = $d['MemberName']; memberSid = $d['MemberSid']; by = $d['SubjectUserName'] }
  })
  $rdp = @(Get-WinEvent -LogName 'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational' -MaxEvents 100 -ErrorAction SilentlyContinue -FilterXPath "*[System[(EventID=1149) and TimeCreated[timediff(@SystemTime) <= $window]]]" | ForEach-Object {
    $u = $null
    try { $u = ([xml]$_.ToXml()).Event.UserData.EventXML } catch {}
    [ordered]@{ time = Ms $_.TimeCreated; user = [string]$u.Param1; domain = [string]$u.Param2; ip = [string]$u.Param3 }
  })
  [ordered]@{ success = $success; failed = $failed; accountChanges = $changes; rdp = $rdp }
}

Section 'keyboard' {
  $cls = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4D36E96B-E325-11CE-BFC1-08002BE10318}'
  $upper = @(Get-RegValue $cls 'UpperFilters' | Where-Object { $_ } | ForEach-Object { [string]$_ })
  $lower = @(Get-RegValue $cls 'LowerFilters' | Where-Object { $_ } | ForEach-Object { [string]$_ })
  $drivers = @(foreach ($n in @($upper + $lower)) {
    $svc = "HKLM:\SYSTEM\CurrentControlSet\Services\$n"
    [ordered]@{ name = $n; image = [string](Get-RegValue $svc 'ImagePath'); display = [string](Get-RegValue $svc 'DisplayName') }
  })
  [ordered]@{ upper = $upper; lower = $lower; drivers = $drivers }
}

Section 'injection' {
  $win = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows'
  $win32 = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Windows'
  $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  $lsa = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'
  $ifeo = @(foreach ($base in 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Image File Execution Options') {
    foreach ($k in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
      $dbg = $k.GetValue('Debugger')
      if ($dbg) { [ordered]@{ exe = [string]$k.PSChildName; debugger = [string]$dbg; key = [string]$k.Name } }
    }
  })
  $silent = @(foreach ($k in @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit' -ErrorAction SilentlyContinue)) {
    $m = $k.GetValue('MonitorProcess')
    if ($m) { [ordered]@{ exe = [string]$k.PSChildName; monitor = [string]$m; key = [string]$k.Name } }
  })
  [ordered]@{
    appInit       = [string](Get-RegValue $win 'AppInit_DLLs')
    loadAppInit   = Get-RegValue $win 'LoadAppInit_DLLs'
    appInit32     = [string](Get-RegValue $win32 'AppInit_DLLs')
    loadAppInit32 = Get-RegValue $win32 'LoadAppInit_DLLs'
    shell         = [string](Get-RegValue $wl 'Shell')
    userinit      = [string](Get-RegValue $wl 'Userinit')
    userShell     = [string](Get-RegValue 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' 'Shell')
    notification  = @(Get-RegValue $lsa 'Notification Packages' | ForEach-Object { [string]$_ })
    security      = @(Get-RegValue $lsa 'Security Packages' | ForEach-Object { [string]$_ })
    authentication = @(Get-RegValue $lsa 'Authentication Packages' | ForEach-Object { [string]$_ })
    wdigest       = Get-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest' 'UseLogonCredential'
    ifeo          = $ifeo
    silentExit    = $silent
  }
}

Section 'sharing' {
  $shares = @(Get-SmbShare -ErrorAction Stop | ForEach-Object {
    $s = $_
    [ordered]@{
      name = [string]$s.Name; path = [string]$s.Path; special = [bool]$s.Special; description = [string]$s.Description
      access = @(Get-SmbShareAccess -Name $s.Name -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{ account = [string]$_.AccountName; right = [string]$_.AccessRight; type = [string]$_.AccessControlType }
      })
    }
  })
  $sessions = @(Get-SmbSession -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ client = [string]$_.ClientComputerName; user = [string]$_.ClientUserName; opens = [int]$_.NumOpens; seconds = [int64]$_.SecondsExists }
  })
  $open = @(Get-SmbOpenFile -ErrorAction SilentlyContinue | Select-Object -First 50 | ForEach-Object {
    [ordered]@{ path = [string]$_.Path; client = [string]$_.ClientComputerName; user = [string]$_.ClientUserName }
  })
  $cfg = Get-SmbServerConfiguration -ErrorAction SilentlyContinue
  [ordered]@{ shares = $shares; sessions = $sessions; openFiles = $open; smb1 = [bool]$cfg.EnableSMB1Protocol }
}

Section 'internet' {
  $is = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | ForEach-Object {
    [ordered]@{ alias = [string]$_.InterfaceAlias; servers = @($_.ServerAddresses | ForEach-Object { [string]$_ }) }
  })
  [ordered]@{
    proxyEnable = Get-RegValue $is 'ProxyEnable'
    proxyServer = [string](Get-RegValue $is 'ProxyServer')
    autoConfig  = [string](Get-RegValue $is 'AutoConfigURL')
    winhttp     = @((netsh winhttp show proxy 2>$null) | ForEach-Object { [string]$_ })
    wlan        = @((netsh wlan show interfaces 2>$null) | ForEach-Object { [string]$_ })
    dns         = $dns
  }
}

Section 'certificates' {
  @(foreach ($store in 'Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root', 'Cert:\LocalMachine\AuthRoot') {
    foreach ($c in @(Get-ChildItem -LiteralPath $store -ErrorAction SilentlyContinue)) {
      [ordered]@{
        store = $store; subject = [string]$c.Subject; issuer = [string]$c.Issuer; thumbprint = [string]$c.Thumbprint
        notBefore = Ms $c.NotBefore; notAfter = Ms $c.NotAfter; hasPrivateKey = [bool]$c.HasPrivateKey; friendly = [string]$c.FriendlyName
      }
    }
  })
}

Section 'browserPolicies' {
  $roots = 'SOFTWARE\Policies\Google\Chrome', 'SOFTWARE\Policies\BraveSoftware\Brave', 'SOFTWARE\Policies\Microsoft\Edge',
    'SOFTWARE\Policies\Chromium', 'SOFTWARE\Policies\Mozilla\Firefox', 'SOFTWARE\Policies\Opera Software\Opera', 'SOFTWARE\Policies\Vivaldi'
  @(foreach ($hive in 'HKLM:', 'HKCU:') {
    foreach ($polRoot in $roots) {
      $path = "$hive\$polRoot"
      if (Test-Path -LiteralPath $path) {
        [ordered]@{
          key = $path
          values = Get-RegValues $path
          subkeys = @(foreach ($s in @(Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue)) {
            [ordered]@{ name = [string]$s.PSChildName; values = Get-RegValues $s.PSPath }
          })
        }
      }
    }
  })
}

Section 'externalExtensions' {
  @(foreach ($base in 'HKLM:\SOFTWARE\Google\Chrome\Extensions', 'HKLM:\SOFTWARE\WOW6432Node\Google\Chrome\Extensions',
      'HKCU:\SOFTWARE\Google\Chrome\Extensions', 'HKLM:\SOFTWARE\Microsoft\Edge\Extensions', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Edge\Extensions',
      'HKCU:\SOFTWARE\Microsoft\Edge\Extensions', 'HKLM:\SOFTWARE\BraveSoftware\Brave\Extensions', 'HKCU:\SOFTWARE\BraveSoftware\Brave\Extensions') {
    foreach ($id in Get-SubKeyNames $base) {
      $v = Get-RegValues "$base\$id"
      [ordered]@{ key = "$base\$id"; id = $id; updateUrl = [string]$v['update_url']; path = [string]$v['path'] }
    }
  })
}

Section 'settings' {
  $pol = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
  $rr = Get-Service -Name RemoteRegistry -ErrorAction SilentlyContinue
  [ordered]@{
    enableLua           = Get-RegValue $pol 'EnableLUA'
    consentAdmin        = Get-RegValue $pol 'ConsentPromptBehaviorAdmin'
    smartScreenPolicy   = Get-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System' 'EnableSmartScreen'
    smartScreenExplorer = [string](Get-RegValue 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer' 'SmartScreenEnabled')
    remoteRegistry      = [ordered]@{ status = [string]$rr.Status; start = [string]$rr.StartType }
  }
}

Out-Result
