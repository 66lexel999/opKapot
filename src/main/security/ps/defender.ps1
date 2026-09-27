# Microsoft Defender threats and detection history.

Section 'threats' {
  @(Get-MpThreat -ErrorAction Stop | ForEach-Object {
    [ordered]@{
      id = [string]$_.ThreatID; name = [string]$_.ThreatName; severity = [int]$_.SeverityID; category = [int]$_.CategoryID
      active = [bool]$_.IsActive; executed = [bool]$_.DidThreatExecute; status = [int]$_.RollupStatus
      resources = @($_.Resources | Where-Object { $_ } | ForEach-Object { [string]$_ })
    }
  })
}

Section 'detections' {
  @(Get-MpThreatDetection -ErrorAction Stop | ForEach-Object {
    [ordered]@{
      id = [string]$_.ThreatID; detectionId = [string]$_.DetectionID
      time = Ms $_.InitialDetectionTime; changed = Ms $_.LastThreatStatusChangeTime; remediated = Ms $_.RemediationTime
      status = [int]$_.ThreatStatusID; success = [bool]$_.ActionSuccess; source = [int]$_.DetectionSourceTypeID
      process = [string]$_.ProcessName; user = [string]$_.DomainUser
      resources = @($_.Resources | Where-Object { $_ } | ForEach-Object { [string]$_ })
    }
  })
}

Out-Result
