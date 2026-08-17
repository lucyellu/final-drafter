Add-Type -AssemblyName System.Drawing

$Dir       = $PSScriptRoot
$IconPath  = Join-Path $Dir 'final-drafter.ico'
$BatPath   = Join-Path $Dir 'launch-final-drafter.bat'
$LinkName  = 'Final Drafter.lnk'
$LinkPath  = Join-Path ([Environment]::GetFolderPath('Desktop')) $LinkName

# -- Draw 256x256 icon --------------------------------------------------
$size = 256
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'

# Background: dark charcoal rounded square with warm gold border
$bgRect = New-Object System.Drawing.Rectangle 4, 4, ($size - 8), ($size - 8)
$path   = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 28
$path.AddArc($bgRect.X,            $bgRect.Y,             $r*2, $r*2, 180, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Y,             $r*2, $r*2, 270, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Bottom - $r*2, $r*2, $r*2, 0,   90)
$path.AddArc($bgRect.X,            $bgRect.Bottom - $r*2, $r*2, $r*2, 90,  90)
$path.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 28, 26))), $path)
$g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 201, 162, 89), 7)), $path)

# Page glyph: off-white sheet with folded corner
$pageW = 108
$pageH = 140
$pageX = ($size - $pageW) / 2 - 10
$pageY = ($size - $pageH) / 2
$fold  = 26

$pagePath = New-Object System.Drawing.Drawing2D.GraphicsPath
$pagePath.AddLine($pageX, $pageY, ($pageX + $pageW - $fold), $pageY)
$pagePath.AddLine(($pageX + $pageW - $fold), $pageY, ($pageX + $pageW), ($pageY + $fold))
$pagePath.AddLine(($pageX + $pageW), ($pageY + $fold), ($pageX + $pageW), ($pageY + $pageH))
$pagePath.AddLine(($pageX + $pageW), ($pageY + $pageH), $pageX, ($pageY + $pageH))
$pagePath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 234, 222))), $pagePath)

# Folded corner triangle (slightly darker)
$foldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$foldPath.AddLine(($pageX + $pageW - $fold), $pageY, ($pageX + $pageW), ($pageY + $fold))
$foldPath.AddLine(($pageX + $pageW), ($pageY + $fold), ($pageX + $pageW - $fold), ($pageY + $fold))
$foldPath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 201, 162, 89))), $foldPath)

# Text lines on the page
$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 30, 28, 26)), 4
$lineXStart = $pageX + 16
$lineXEnd   = $pageX + $pageW - 16
$lineY = $pageY + 54
for ($i = 0; $i -lt 5; $i++) {
    $endX = if ($i -eq 4) { $lineXEnd - 30 } else { $lineXEnd }
    $g.DrawLine($linePen, $lineXStart, $lineY, $endX, $lineY)
    $lineY += 14
}

$g.Dispose()

# -- Wrap PNG into ICO ---------------------------------------------------
$ms  = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray(); $ms.Close(); $bmp.Dispose()

if (Test-Path $IconPath) { Remove-Item $IconPath -Force }
$fs = New-Object System.IO.FileStream $IconPath, 'Create'
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$png.Length); $bw.Write([uint32]22)
$bw.Write($png); $bw.Close(); $fs.Close()

# -- Build .lnk -----------------------------------------------------------
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($LinkPath)
$lnk.TargetPath       = $BatPath
$lnk.WorkingDirectory = $Dir
$lnk.IconLocation     = "$IconPath,0"
$lnk.Description      = 'Final Drafter - screenplay editor'
$lnk.WindowStyle      = 7
$lnk.Save()

Write-Host "Shortcut placed on Desktop: $LinkName"
