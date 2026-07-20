<#
.SYNOPSIS
    Prepares a folder of RelAZ_Assess outputs for the Resiliency Checker app.

.DESCRIPTION
    Takes a folder that may contain a messy mix of zipped and unzipped RelAZ
    outputs and reshapes it into the layout the Resiliency Checker expects:

        <DataRoot>\<Entity>\<YYYY-MM-DD>\MasterReport.csv
        <DataRoot>\<Entity>\<Tenant>\<YYYY-MM-DD>\MasterReport.csv   (multi-tenant)

    - Extracts every .zip found under each entity folder (requires 7-Zip)
    - Flattens any nested subfolders so the CSVs sit directly under a date folder
    - Reads the reportdate column from MasterReport.csv to name the date folder
    - Deletes redundant .zip files and stray PBIT templates after extraction

    Safe to re-run: skips any leaf that's already in the expected layout.

.PARAMETER DataRoot
    Absolute path to the folder that holds one sub-folder per entity.
    Each entity sub-folder can contain either a .zip file or already-extracted
    CSVs. Multi-tenant entities should have one .zip / one folder per tenant.

.PARAMETER SevenZip
    Absolute path to 7z.exe. Defaults to "C:\Program Files\7-Zip\7z.exe".
    Only required if the input contains .zip / .rar files.

.EXAMPLE
    .\prepare-dataset.ps1 -DataRoot "C:\ADGE Resiliency\Assessment Reports"

.NOTES
    Password-protected archives are skipped and reported at the end.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DataRoot,

    [string]$SevenZip = "C:\Program Files\7-Zip\7z.exe"
)

$ErrorActionPreference = 'Stop'

function Test-IsDateFolder { param($Name) $Name -match '^\d{4}-\d{2}-\d{2}$' }
function Test-IsLeafFolder { param($Path) Test-Path (Join-Path $Path 'MasterReport.csv') }

function Get-ReportDateFromCsv {
    param([string]$CsvPath)
    try {
        $first = Import-Csv $CsvPath | Select-Object -First 1
        if ($first -and $first.reportdate) { return $first.reportdate.Trim() }
    } catch { }
    return $null
}

function Extract-Archive {
    param([string]$Archive, [string]$Target)
    if (-not (Test-Path $SevenZip)) {
        throw "7-Zip not found at '$SevenZip'. Install 7-Zip or pass -SevenZip <path>."
    }
    & $SevenZip x "-o$Target" -y $Archive | Out-Null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-Path $DataRoot)) { throw "DataRoot not found: $DataRoot" }

Write-Host "=== Resiliency Checker — dataset preparation ===" -ForegroundColor Cyan
Write-Host "DataRoot: $DataRoot"
Write-Host ""

$skippedArchives = @()
$processed = 0

foreach ($entityDir in Get-ChildItem $DataRoot -Directory) {
    Write-Host "── $($entityDir.Name)"

    # ---- Step 1: extract any .zip / .rar inside this entity folder ----------
    Get-ChildItem $entityDir.FullName -Recurse -File -Include *.zip, *.rar | ForEach-Object {
        $archive = $_
        $targetParent = $archive.Directory.FullName
        $extractTarget = Join-Path $targetParent ([IO.Path]::GetFileNameWithoutExtension($archive.Name))
        if (Test-Path (Join-Path $targetParent 'MasterReport.csv')) {
            Write-Host "  · already extracted next to $($archive.Name), removing archive"
            Remove-Item $archive.FullName -Force
            return
        }
        New-Item -ItemType Directory -Path $extractTarget -Force | Out-Null
        Write-Host "  · extracting $($archive.Name)"
        try {
            $ok = Extract-Archive -Archive $archive.FullName -Target $extractTarget
            if ($ok) { Remove-Item $archive.FullName -Force }
        } catch {
            Write-Host "  ! failed to extract $($archive.Name): $_" -ForegroundColor Red
            $skippedArchives += $archive.FullName
        }
    }

    # ---- Step 2: locate every "leaf" (folder containing MasterReport.csv) ---
    $leaves = Get-ChildItem $entityDir.FullName -Directory -Recurse | Where-Object {
        Test-IsLeafFolder $_.FullName
    }
    if (Test-IsLeafFolder $entityDir.FullName) { $leaves = @($entityDir) + $leaves }

    foreach ($leaf in $leaves) {
        # Already in the correct layout?
        if (Test-IsDateFolder $leaf.Name) {
            Write-Host "  · $($leaf.Name) already in place"
            $processed++
            continue
        }

        $reportDate = Get-ReportDateFromCsv (Join-Path $leaf.FullName 'MasterReport.csv')
        if (-not $reportDate) {
            Write-Host "  ! could not read reportdate from $($leaf.FullName), skipping" -ForegroundColor Yellow
            continue
        }

        # Decide parent: same as leaf's parent (single-tenant) or leaf's parent's parent
        # if the leaf lives inside a tenant folder.
        $target = Join-Path $leaf.Parent.FullName $reportDate
        if ($leaf.Parent.FullName -eq $entityDir.FullName) {
            # single-tenant: <Entity>\<RunDate>
            $target = Join-Path $entityDir.FullName $reportDate
        } else {
            # multi-tenant: <Entity>\<Tenant>\<RunDate>
            $target = Join-Path $leaf.Parent.FullName $reportDate
        }

        if (Test-Path $target) {
            Write-Host "  ! target $target already exists, skipping" -ForegroundColor Yellow
            continue
        }

        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Get-ChildItem $leaf.FullName -File | ForEach-Object {
            if ($_.Extension -in '.pbit') {
                Remove-Item $_.FullName -Force   # duplicate PBIT — the one at DataRoot is authoritative
            } else {
                Move-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
            }
        }

        # Remove the now-empty original leaf folder if it isn't the entity dir itself
        if ($leaf.FullName -ne $entityDir.FullName) {
            if ((Get-ChildItem $leaf.FullName -Force).Count -eq 0) {
                Remove-Item $leaf.FullName -Force
            }
        }

        Write-Host "  → $($leaf.Name) reshaped to $reportDate/"
        $processed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Leaves processed: $processed"
if ($skippedArchives) {
    Write-Host ""
    Write-Host "Password-protected or failed archives:" -ForegroundColor Yellow
    $skippedArchives | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "Dataset ready. Start the app with:  node server/index.js --data-root=`"$DataRoot`""
