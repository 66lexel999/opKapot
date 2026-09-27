# Lists the firewall rules opKapot created to block programs.

Section 'blocked' {
  @(foreach ($rule in @(Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.DisplayName -like 'opKapot block*' -or $_.Group -eq 'opKapot' })) {
    $app = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
    [ordered]@{
      name        = [string]$rule.Name
      displayName = [string]$rule.DisplayName
      direction   = [string]$rule.Direction
      action      = [string]$rule.Action
      enabled     = [string]$rule.Enabled
      program     = [string]$app.Program
    }
  })
}

Out-Result
