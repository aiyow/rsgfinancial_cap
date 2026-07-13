param(
  [string]$SourceHtml = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.html'),
  [string]$OutputDocx = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.docx'),
  [string]$OutputPdf = (Join-Path $PSScriptRoot 'RSG_Condo_User_Manual.pdf')
)

$ErrorActionPreference = 'Stop'

$sourcePath = (Resolve-Path -LiteralPath $SourceHtml).Path
$docxPath = [System.IO.Path]::GetFullPath($OutputDocx)
$pdfPath = [System.IO.Path]::GetFullPath($OutputPdf)

$wdFormatDocumentDefault = 16
$wdExportFormatPdf = 17
$wdPaperA4 = 7
$wdOrientPortrait = 0
$wdHeaderFooterPrimary = 1
$wdHeaderFooterFirstPage = 2
$wdCollapseEnd = 0
$wdCollapseStart = 1
$wdPageBreak = 7
$wdFieldPage = 33
$wdFieldNumPages = 26
$wdAlignParagraphCenter = 1
$wdAlignParagraphRight = 2

$word = $null
$document = $null

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0

  $document = $word.Documents.Open($sourcePath, $false, $false)
  try {
    $document.BuiltInDocumentProperties.Item('Title').Value = 'RSG Condo Management and Billing System - User Manual'
    $document.BuiltInDocumentProperties.Item('Subject').Value = 'End-user instructions for Admin, Collector, and Resident roles'
    $document.BuiltInDocumentProperties.Item('Author').Value = 'RSG Condo Project'
    $document.BuiltInDocumentProperties.Item('Keywords').Value = 'RSG Condo, user manual, admin, collector, resident, billing, SOA, payments, analytics'
  } catch {
    # Some Word installations do not expose document properties through COM.
  }

  # Word imports most print CSS, but it does not reliably honor a page break
  # after an HTML section. Force the document-information page to begin after
  # the cover and normalize the cover logo and title treatment.
  $documentHeading = $document.Content.Duplicate
  $documentHeading.Find.ClearFormatting()
  $documentHeading.Find.Text = 'Document Information'
  if ($documentHeading.Find.Execute()) {
    $documentHeading.Collapse($wdCollapseStart)
    $documentHeading.InsertBreak($wdPageBreak)
  }

  if ($document.InlineShapes.Count -gt 0) {
    $logo = $document.InlineShapes.Item(1)
    $logo.LockAspectRatio = -1
    $logo.Width = 240
    $logo.Range.ParagraphFormat.Alignment = $wdAlignParagraphCenter
    $logo.Range.ParagraphFormat.SpaceBefore = 55
    $logo.Range.ParagraphFormat.SpaceAfter = 30
  }

  if ($document.Tables.Count -gt 0) {
    $roleTable = $document.Tables.Item(1)
    $roleTable.Range.ParagraphFormat.Alignment = $wdAlignParagraphCenter
    $roleTable.Range.Font.Name = 'Aptos'
    $roleTable.Range.Font.Size = 10
    $roleTable.Range.Font.Bold = -1
  }

  $coverStyles = @(
    @{ Text = 'RSG Condo'; Size = 28; Bold = -1; Before = 0; After = 14 },
    @{ Text = 'Management and Billing System'; Size = 19; Bold = -1; Before = 0; After = 12 },
    @{ Text = 'End-User Manual'; Size = 14; Bold = -1; Before = 0; After = 25 },
    @{ Text = 'Version 1.0'; Size = 11; Bold = -1; Before = 42; After = 6 },
    @{ Text = 'Prepared 13 July 2026'; Size = 10; Bold = 0; Before = 0; After = 5 },
    @{ Text = 'Based on the implemented application screens, permissions, and server rules.'; Size = 9; Bold = 0; Before = 0; After = 0 }
  )
  foreach ($coverStyle in $coverStyles) {
    $coverRange = $document.Content.Duplicate
    $coverRange.Find.ClearFormatting()
    $coverRange.Find.Text = $coverStyle.Text
    if ($coverRange.Find.Execute()) {
      $coverRange.Font.Name = 'Aptos Display'
      $coverRange.Font.Size = $coverStyle.Size
      $coverRange.Font.Bold = $coverStyle.Bold
      $coverRange.Font.Color = 3238679
      $coverRange.ParagraphFormat.Alignment = $wdAlignParagraphCenter
      $coverRange.ParagraphFormat.SpaceBefore = $coverStyle.Before
      $coverRange.ParagraphFormat.SpaceAfter = $coverStyle.After
    }
  }

  foreach ($section in $document.Sections) {
    $section.PageSetup.PaperSize = $wdPaperA4
    $section.PageSetup.Orientation = $wdOrientPortrait
    $section.PageSetup.TopMargin = $word.MillimetersToPoints(18)
    $section.PageSetup.BottomMargin = $word.MillimetersToPoints(18)
    $section.PageSetup.LeftMargin = $word.MillimetersToPoints(17)
    $section.PageSetup.RightMargin = $word.MillimetersToPoints(17)
    $section.PageSetup.DifferentFirstPageHeaderFooter = $true

    $header = $section.Headers.Item($wdHeaderFooterPrimary)
    $header.Range.Text = 'RSG Condo Management and Billing System  |  User Manual'
    $header.Range.Font.Name = 'Aptos'
    $header.Range.Font.Size = 8
    $header.Range.Font.Color = 5263440
    $header.Range.ParagraphFormat.Alignment = $wdAlignParagraphRight

    $firstHeader = $section.Headers.Item($wdHeaderFooterFirstPage)
    $firstHeader.Range.Text = ''

    $footer = $section.Footers.Item($wdHeaderFooterPrimary)
    $footer.Range.Text = 'RSG Condo User Manual  |  Page '
    $footer.Range.Font.Name = 'Aptos'
    $footer.Range.Font.Size = 8
    $footer.Range.Font.Color = 5263440
    $footer.Range.ParagraphFormat.Alignment = $wdAlignParagraphCenter

    $range = $footer.Range
    $range.Collapse($wdCollapseEnd)
    $range.Fields.Add($range, $wdFieldPage) | Out-Null
    $range = $footer.Range
    $range.Collapse($wdCollapseEnd)
    $range.InsertAfter(' of ')
    $range.Collapse($wdCollapseEnd)
    $range.Fields.Add($range, $wdFieldNumPages) | Out-Null

    $firstFooter = $section.Footers.Item($wdHeaderFooterFirstPage)
    $firstFooter.Range.Text = ''
  }

  $document.Fields.Update() | Out-Null
  $document.SaveAs2($docxPath, $wdFormatDocumentDefault)
  $document.ExportAsFixedFormat($pdfPath, $wdExportFormatPdf)
}
finally {
  if ($document -ne $null) {
    $document.Close($false)
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
  }
  if ($word -ne $null) {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Get-Item -LiteralPath $docxPath, $pdfPath | Select-Object FullName, Length, LastWriteTime
