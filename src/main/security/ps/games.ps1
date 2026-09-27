# Where games and launchers are installed, for the Game Mode picker. Read-only.

Section 'steam' {
  $steamDir = Get-RegValue 'HKCU:\Software\Valve\Steam' 'SteamPath'
  if (-not $steamDir) { $steamDir = Get-RegValue 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' 'InstallPath' }
  [string]$steamDir
}

Section 'ea' {
  @(foreach ($base in 'HKLM:\SOFTWARE\WOW6432Node\EA Games', 'HKLM:\SOFTWARE\EA Games', 'HKLM:\SOFTWARE\WOW6432Node\Electronic Arts\EA Games', 'HKLM:\SOFTWARE\Electronic Arts\EA Games') {
    foreach ($n in @(Get-SubKeyNames $base)) {
      $v = Get-RegValues "$base\$n"
      [ordered]@{ name = [string]$n; dir = [string]$v['Install Dir']; displayName = [string]$v['DisplayName'] }
    }
  })
}

Section 'uninstall' {
  @(foreach ($base in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
    foreach ($n in @(Get-SubKeyNames $base)) {
      $v = Get-RegValues "$base\$n"
      $pub = [string]$v['Publisher']
      $dir = [string]$v['InstallLocation']
      if ($pub -match 'Electronic Arts|EA Sports|Ubisoft|Riot|Blizzard|Rockstar|Epic Games|2K|Activision|Bandai|Konami|Bethesda|Take-Two|Codemasters|Psyonix' -or $dir -match 'steamapps\\common|\\EA Games\\|\\Epic Games\\') {
        [ordered]@{ key = [string]$n; name = [string]$v['DisplayName']; publisher = $pub; dir = $dir; icon = [string]$v['DisplayIcon'] }
      }
    }
  })
}

Out-Result
