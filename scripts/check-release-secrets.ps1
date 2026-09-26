$ErrorActionPreference = 'Stop'
$secretPattern = '(?i)(DEEPL_(API_KEY|AUTH_KEY|API_TOKEN)\s*=\s*[^#\s]{12,}|DeepL-Auth-Key\s+[A-Za-z0-9_-]{12,})'
$scanRoots = @('.')
$matches = @()
foreach ($root in $scanRoots) {
  $matches += @(rg --files-with-matches --pcre2 $secretPattern $root --glob '!.env' --glob '!node_modules/**' --glob '!dist/**' --glob '!src-tauri/target/**' --glob '!scripts/check-release-secrets.ps1' 2>$null)
}
$historyPattern = '[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{12\}'
$history = @(git log --all --format=%H -G $historyPattern)
if ($matches.Count -gt 0 -or $history.Count -gt 0) {
  Write-Error 'Release secret scan failed. Remove the credential from the working tree and Git history before release.'
}
Write-Host 'Release secret scan passed: no DeepL key-shaped credential found in release inputs or Git history.'
