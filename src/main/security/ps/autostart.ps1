# Read-only: is opKapot's own sign-in task registered, and what does it start?

Section 'task' {
  $t = @(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq [string]$P.name }) | Select-Object -First 1
  if (-not $t) { [ordered]@{ exists = $false } }
  else {
    $a = @($t.Actions)[0]
    [ordered]@{ exists = $true; enabled = ([string]$t.State -ne 'Disabled'); exe = [string]$a.Execute; args = [string]$a.Arguments }
  }
}

Out-Result
