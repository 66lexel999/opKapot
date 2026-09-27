# What is running, for Game Mode. Read-only.

$mySession = (Get-Process -Id $PID).SessionId

Section 'processes' {
  $parents = @{}
  # Parent IDs group helper processes under their app; the list still works without them.
  try { foreach ($c in @(Get-CimInstance Win32_Process -ErrorAction Stop)) { $parents[[int]$c.ProcessId] = [int]$c.ParentProcessId } } catch {}
  @(Get-Process -ErrorAction Stop | Where-Object { $_.SessionId -eq $mySession } | ForEach-Object {
    [ordered]@{
      pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path
      window = ($_.MainWindowHandle -ne [IntPtr]::Zero); title = [string]$_.MainWindowTitle
      memory = [int64]$_.WorkingSet64; company = [string]$_.Company; description = [string]$_.Description
      parent = [int]$parents[[int]$_.Id]
    }
  })
}

Section 'services' {
  @(Get-Service -ErrorAction Stop | Where-Object { $_.Status -eq 'Running' } | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; display = [string]$_.DisplayName; canStop = [bool]$_.CanStop }
  })
}

Section 'power' {
  [ordered]@{
    active = [string](powercfg.exe /getactivescheme 2>$null)
    list = @(powercfg.exe /list 2>$null | ForEach-Object { [string]$_ })
  }
}

Out-Result
