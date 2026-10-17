param(
  [string]$SourceHtml = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.html'),
  [string]$OutputDocx = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.docx'),
  [string]$OutputPdf = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.pdf'),
  [string]$PythonExecutable = (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $SourceHtml).Path
$docxPath = [System.IO.Path]::GetFullPath($OutputDocx)
$pdfPath = [System.IO.Path]::GetFullPath($OutputPdf)
if (-not (Test-Path -LiteralPath $PythonExecutable)) {
  throw 'Set -PythonExecutable to a Python installation with python-docx, Pillow and lxml.'
}
foreach ($outputPath in @($docxPath, $pdfPath)) {
  if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($outputPath)))) {
    throw "Output directory does not exist: $outputPath"
  }
}

# One HTML source feeds the diagram assets and editable Word document.
& $PythonExecutable (Join-Path $PSScriptRoot 'build_user_manual.py') --source $sourcePath --output-docx $docxPath
if ($LASTEXITCODE -ne 0) { throw 'Manual diagram or Word generation failed.' }

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($docxPath, $false, $false)
  $document.Repaginate()
  $document.Fields.Update() | Out-Null
  foreach ($section in $document.Sections) {
    foreach ($footer in $section.Footers) { $footer.Range.Fields.Update() | Out-Null }
  }
  $document.Save()
  $document.ExportAsFixedFormat($pdfPath, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
}
finally {
  if ($null -ne $document) {
    $document.Close($false)
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
  }
  if ($null -ne $word) {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Get-Item -LiteralPath $docxPath, $pdfPath | Select-Object FullName, Length, LastWriteTime
