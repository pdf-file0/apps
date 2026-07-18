param(
    [int]$PeerPid = 27812,
    [string]$PeerId = "e45myl1f",
    [string]$RepoPath = "C:\Users\samli\OneDrive\Documents\norman",
    [string]$TaskName = "Codex Auto Push e45myl1f Phase15B"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ScriptDir "auto-push-e45myl1f.log"

function Write-Log {
    param([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
}

function Stop-Watcher {
    Write-Log "Stopping scheduled task '$TaskName'."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

try {
    $process = Get-Process -Id $PeerPid -ErrorAction SilentlyContinue
    if ($null -ne $process) {
        Write-Log "Peer $PeerId is still running at PID $PeerPid; waiting."
        exit 0
    }

    Write-Log "Peer $PeerId PID $PeerPid is no longer running; checking repository."

    if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) {
        throw "Repository path does not exist: $RepoPath"
    }

    Push-Location -LiteralPath $RepoPath
    try {
        $isRepo = & git rev-parse --is-inside-work-tree 2>&1
        if ($LASTEXITCODE -ne 0 -or ($isRepo | Select-Object -First 1) -ne "true") {
            throw "Not a git repository: $RepoPath"
        }

        $branch = (& git branch --show-current 2>&1 | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
            throw "Cannot push automatically because the repository is in detached HEAD state."
        }

        $fetchOutput = & git fetch --quiet --prune origin 2>&1
        $fetchExit = $LASTEXITCODE
        if ($fetchOutput) {
            $fetchOutput | ForEach-Object { Write-Log "git fetch: $_" }
        }
        if ($fetchExit -ne 0) {
            throw "git fetch failed with exit code $fetchExit"
        }

        $upstream = (& git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null | Select-Object -First 1)
        $hasUpstream = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream)

        if ($hasUpstream) {
            $counts = (& git rev-list --left-right --count "$upstream...HEAD" 2>&1 | Select-Object -First 1)
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($counts)) {
                throw "Could not compute ahead/behind counts for $upstream...HEAD"
            }

            $parts = $counts -split "\s+"
            $behind = [int]$parts[0]
            $ahead = [int]$parts[1]
            Write-Log "Branch '$branch' is behind $behind and ahead $ahead relative to '$upstream'."

            if ($ahead -eq 0) {
                Write-Log "No committed changes are ahead of upstream; nothing to push."
                Stop-Watcher
                exit 0
            }

            if ($behind -gt 0) {
                throw "Local branch is behind upstream by $behind commit(s); refusing to push automatically."
            }

            $pushOutput = & git push --porcelain 2>&1
        }
        else {
            Write-Log "Branch '$branch' has no upstream; pushing with upstream set to origin/$branch."
            $pushOutput = & git push --porcelain --set-upstream origin $branch 2>&1
        }

        $pushExit = $LASTEXITCODE
        if ($pushOutput) {
            $pushOutput | ForEach-Object { Write-Log "git push: $_" }
        }

        if ($pushExit -ne 0) {
            throw "git push failed with exit code $pushExit"
        }

        Write-Log "Push completed successfully."
        Stop-Watcher
        exit 0
    }
    finally {
        Pop-Location
    }
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
