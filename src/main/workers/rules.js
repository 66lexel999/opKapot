'use strict';

// Encoded detection patterns (see heuristics.js). Base64 so that antivirus
// software does not mistake opKapot's own files for the malware they describe.
// Decode any entry with Buffer.from(pattern, 'base64').toString().
// [id, severity, applies to, title, why, pattern]
module.exports = {
  RULES: [
  ["amsi-bypass", "high", "script", "Tries to switch off Windows malware scanning (AMSI bypass)", "Scripts only do this to hide from antivirus.", "YW1zaXV0aWxzfGFtc2lpbml0ZmFpbGVkfGFtc2lzY2FuYnVmZmVyfGFtc2ljb250ZXh0"],
  ["defender-tamper", "high", "script", "Tries to disable or blind Microsoft Defender", "It adds virus-scan exclusions or turns protection off.", "YWRkLW1wcHJlZmVyZW5jZVteXG5dezAsNDB9LWV4Y2x1c2lvbnxzZXQtbXBwcmVmZXJlbmNlW15cbl17MCw0MH0tZGlzYWJsZShyZWFsdGltZW1vbml0b3Jpbmd8YmVoYXZpb3Jtb25pdG9yaW5nfGlvYXZwcm90ZWN0aW9ufHNjcmlwdHNjYW5uaW5nKVxzK1wkPyh0cnVlfDEpfGRpc2FibGVhbnRpc3B5d2FyZVteXG5dezAsNDB9KDF8dHJ1ZSk="],
  ["shadow-delete", "high", "script", "Deletes Windows backups (typical of ransomware)", "Ransomware removes restore points so you cannot recover your files.", "dnNzYWRtaW4oXC5leGUpP1xzK2RlbGV0ZVxzK3NoYWRvd3N8d21pYyhcLmV4ZSk/XHMrc2hhZG93Y29weVxzK2RlbGV0ZXx3YmFkbWluKFwuZXhlKT9ccytkZWxldGVccytjYXRhbG9nfGJjZGVkaXQoXC5leGUpP1xzKy9zZXRccytce2RlZmF1bHRcfVxzK3JlY292ZXJ5ZW5hYmxlZFxzK25v"],
  ["ps-encoded", "high", "script", "Runs a hidden, encoded PowerShell command", "Malware hides its real commands in Base64.", "cG93ZXJzaGVsbFteXG5dezAsMTIwfVxzLWUobmN8bmNvZGVkY29tbWFuZCk/XHMrW2EtejAtOSsvPV17NjAsfQ=="],
  ["download-exec", "high", "script", "Downloads and runs code from the internet", "A classic malware \"dropper\" pattern.", "KGlleHxpbnZva2UtZXhwcmVzc2lvbilbXlxuXXswLDIwMH0oZG93bmxvYWRzdHJpbmd8ZG93bmxvYWRkYXRhfG5ldFwud2ViY2xpZW50fGludm9rZS13ZWJyZXF1ZXN0fGludm9rZS1yZXN0bWV0aG9kfFxiaXdyXGJ8XGJpcm1cYil8KGRvd25sb2Fkc3RyaW5nfGRvd25sb2FkZGF0YSlbXlxuXXswLDIwMH0oaWV4fGludm9rZS1leHByZXNzaW9uKQ=="],
  ["certutil-download", "high", "script", "Uses certutil to download or decode hidden files", "certutil is a Windows tool attackers abuse to fetch malware.", "Y2VydHV0aWwoXC5leGUpP1teXG5dezAsNjB9KC11cmxjYWNoZXwtZGVjb2RlfC1kZWNvZGVoZXgp"],
  ["bitsadmin", "medium", "script", "Downloads files with bitsadmin", "Often used by malware to download files quietly.", "Yml0c2FkbWluKFwuZXhlKT9bXlxuXXswLDQwfS90cmFuc2Zlcg=="],
  ["mshta-remote", "high", "script", "Runs a script straight from the internet (mshta)", "", "bXNodGEoXC5leGUpP1xzK1siJ10/KGh0dHBzPzp8dmJzY3JpcHQ6fGphdmFzY3JpcHQ6KQ=="],
  ["regsvr32-remote", "high", "script", "Loads a remote script through regsvr32 (\"Squiblydoo\")", "", "cmVnc3ZyMzIoXC5leGUpP1teXG5dezAsODB9L2k6XHMqaHR0cHM/Og=="],
  ["reflective-load", "high", "script", "Loads a program directly into memory", "Fileless malware runs this way so nothing is saved to disk.", "XFsoc3lzdGVtXC4pP3JlZmxlY3Rpb25cLmFzc2VtYmx5XF06OmxvYWRccypcKHx2aXJ0dWFsYWxsb2NbXHNcU117MCw0MDB9KGNyZWF0ZXRocmVhZHxydGxtb3ZlbWVtb3J5KQ=="],
  ["keylogger-api", "high", "script", "Records what you type (keylogger code)", "The script reads keyboard input from every program.", "Z2V0YXN5bmNrZXlzdGF0ZXxzZXR3aW5kb3dzaG9va2V4W1xzXFNdezAsMjAwfSh3aF9rZXlib2FyZF9sbHxcYjEzXGIpfHdoX2tleWJvYXJkX2xsfHB5bnB1dFwua2V5Ym9hcmRbXHNcU117MCw0MDB9bGlzdGVuZXJ8a2V5Ym9hcmRcLm9uX3ByZXNzfGtleWJvYXJkXC5ob29rXCg="],
  ["stealer", "high", "script", "Steals saved browser passwords or cookies", "It reads the files where browsers keep your logins.", "KGxvZ2luIGRhdGF8XFxjb29raWVzfGxvY2FsIHN0YXRlKVtcc1xTXXswLDYwMH0oY3J5cHR1bnByb3RlY3RkYXRhfHdpbjMyY3J5cHR8b3NfY3J5cHR8ZW5jcnlwdGVkX2tleXxhZXNnY218c3FsaXRlMyl8KGNyeXB0dW5wcm90ZWN0ZGF0YXx3aW4zMmNyeXB0KVtcc1xTXXswLDYwMH0obG9naW4gZGF0YXxwYXNzd29yZF92YWx1ZSk="],
  ["token-grabber", "high", "script", "Steals Discord or browser login tokens", "", "ZGlzY29yZFtcc1xTXXswLDQwMH1sb2NhbCBzdG9yYWdlW1xcL10rbGV2ZWxkYnxtZmFcLltcdy1dezgwLH18XFtcXHctXF1cezI0XH1cXFwuXFtcXHctXF1cezZcfQ=="],
  ["exfil-webhook", "medium", "script", "Sends data to a Discord webhook or Telegram bot", "Stolen data is often sent this way.", "ZGlzY29yZChhcHApP1wuY29tL2FwaS93ZWJob29rcy9cZCt8YXBpXC50ZWxlZ3JhbVwub3JnL2JvdFxkKzo="],
  ["vbs-dropper", "high", "script", "Script that downloads files and runs them", "", "KG1zeG1sMlwuKHNlcnZlcik/eG1saHR0cHx3aW5odHRwXC53aW5odHRwcmVxdWVzdHxtaWNyb3NvZnRcLnhtbGh0dHApW1xzXFNdezAsMTUwMH0oYWRvZGJcLnN0cmVhbXxzYXZldG9maWxlKVtcc1xTXXswLDE1MDB9KHdzY3JpcHRcLnNoZWxsfHNoZWxsXC5hcHBsaWNhdGlvbik="],
  ["hidden-powershell", "medium", "script", "Starts PowerShell in a hidden window", "", "cG93ZXJzaGVsbChcLmV4ZSk/W15cbl17MCw4MH1ccy13KGluZG93c3R5bGUpP1xzK2goaWRkZW4pP1xi"],
  ["persistence", "medium", "script", "Adds itself to Windows startup", "", "cmVnKFwuZXhlKT9ccythZGRccytbXlxuXXswLDgwfVxcY3VycmVudHZlcnNpb25cXHJ1blxifHNjaHRhc2tzKFwuZXhlKT9ccysvY3JlYXRlfG5ldy1pdGVtcHJvcGVydHlbXlxuXXswLDEyMH1cXGN1cnJlbnR2ZXJzaW9uXFxydW5cYnxyZWdpc3Rlci1zY2hlZHVsZWR0YXNr"],
  ["security-off", "high", "script", "Turns off Windows security features", "", "bmV0c2hccysoYWR2KT9maXJld2FsbFxzK3NldFxzK1x3K1xzK3N0YXRlXHMrb2ZmfHNjKFwuZXhlKT9ccysoc3RvcHxjb25maWcpXHMrd2luZGVmZW5kfGVuYWJsZWx1YVteXG5dezAsNDB9L2Rccyow"],
  ["obfuscated-js", "medium", "script", "Heavily obfuscated script", "Code is scrambled so people and antivirus can't read it.", "ZXZhbFxzKlwoW1xzXFNdezAsNTB9KHVuZXNjYXBlfGF0b2J8c3RyaW5nXC5mcm9tY2hhcmNvZGUpfChcXHhbMC05YS1mXXsyfSl7NjAsfXwoc3RyaW5nXC5mcm9tY2hhcmNvZGVcKFxzKihcZCtccyosXHMqKXs0MH0p"],
  ["lnk-launcher", "high", "lnk", "Shortcut that secretly runs commands", "Malicious shortcuts look like documents but start PowerShell or scripts.", "KHBvd2Vyc2hlbGx8cHdzaHxjbWQoXC5leGUpP1xzKi9jfG1zaHRhfHdzY3JpcHR8Y3NjcmlwdHxydW5kbGwzMnxyZWdzdnIzMnxiaXRzYWRtaW58Y2VydHV0aWx8Y3VybFxzKy0pW1xzXFNdezAsMzAwfShodHRwcz86fC1lbmN8LWVcc3xoaWRkZW58XC52YnN8XC5qc1xifFwuaHRhfFwucHMxfFwuYmF0fCV0ZW1wJXwlYXBwZGF0YSUp"],
  ["url-file", "medium", "url", "Internet shortcut that opens a file on another computer", "", "dXJsXHMqPVxzKihmaWxlOnxcXFxcKQ=="],
  ["reg-autorun", "medium", "reg", "Registry file that adds startup or hijack entries", "", "XFxjdXJyZW50dmVyc2lvblxcKHJ1bnxydW5vbmNlKVxdfGltYWdlIGZpbGUgZXhlY3V0aW9uIG9wdGlvbnNcXFteXF1dK1xdfFxcd2lubG9nb25cXVtcc1xTXXswLDIwMH0iKHNoZWxsfHVzZXJpbml0KSJ8ZGlzYWJsZWFudGlzcHl3YXJl"],
  ],
  EICAR: ["WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJ","Q0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="],
  RANSOM_WORDS: "ZGVjcnlwdHxiaXRjb2lufFxiYnRjXGJ8cmFuc29tfGZpbGVzIChoYXZlIGJlZW58YXJlKSBlbmNyeXB0ZWR8cGVyc29uYWwgaWR8cHJpdmF0ZSBrZXl8dG9yIGJyb3dzZXJ8XC5vbmlvbnxtb25lcm8=",
};
