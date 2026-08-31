Add-Type -AssemblyName System.Drawing

$Dir      = $PSScriptRoot
$IconPath = Join-Path $Dir 'studio-hub.ico'
$BatPath  = Join-Path $Dir 'launch-studio-hub.bat'
$LinkName = 'Studio Hub.lnk'
$LinkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) $LinkName

# -- Draw 256x256 icon ---------------------------------------------------
# Family resemblance to final-drafter.ico (dark tile + cream page), but the
# Studio Hub is the library, so it wears the hub's red instead of the gold.
$size = 256
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'

$cream = [System.Drawing.Color]::FromArgb(255, 240, 234, 222)
$red   = [System.Drawing.Color]::FromArgb(255, 229, 9, 20)
$ink   = [System.Drawing.Color]::FromArgb(255, 11, 11, 15)

# Background: near-black rounded square with a red border
$bgRect = New-Object System.Drawing.Rectangle 4, 4, ($size - 8), ($size - 8)
$path   = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 28
$path.AddArc($bgRect.X,            $bgRect.Y,             $r*2, $r*2, 180, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Y,             $r*2, $r*2, 270, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Bottom - $r*2, $r*2, $r*2, 0,   90)
$path.AddArc($bgRect.X,            $bgRect.Bottom - $r*2, $r*2, $r*2, 90,  90)
$path.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $ink), $path)
$g.DrawPath((New-Object System.Drawing.Pen $red, 7), $path)

# The script: a cream page with a folded corner
$pageW = 108; $pageH = 138
$pageX = ($size - $pageW) / 2
$pageY = ($size - $pageH) / 2
$fold  = 26

$pagePath = New-Object System.Drawing.Drawing2D.GraphicsPath
$pagePath.AddLine($pageX, $pageY, ($pageX + $pageW - $fold), $pageY)
$pagePath.AddLine(($pageX + $pageW - $fold), $pageY, ($pageX + $pageW), ($pageY + $fold))
$pagePath.AddLine(($pageX + $pageW), ($pageY + $fold), ($pageX + $pageW), ($pageY + $pageH))
$pagePath.AddLine(($pageX + $pageW), ($pageY + $pageH), $pageX, ($pageY + $pageH))
$pagePath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $cream), $pagePath)

$foldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$foldPath.AddLine(($pageX + $pageW - $fold), $pageY, ($pageX + $pageW), ($pageY + $fold))
$foldPath.AddLine(($pageX + $pageW), ($pageY + $fold), ($pageX + $pageW - $fold), ($pageY + $fold))
$foldPath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $red), $foldPath)

# The movie: a red play triangle sitting on the page
$cx = $size / 2; $cy = $size / 2
$playPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$playPath.AddLine(($cx - 22), ($cy - 30), ($cx - 22), ($cy + 30))
$playPath.AddLine(($cx - 22), ($cy + 30), ($cx + 28), $cy)
$playPath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $red), $playPath)

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

# -- Build .lnk ----------------------------------------------------------
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($LinkPath)
$lnk.TargetPath       = $BatPath
$lnk.WorkingDirectory = $Dir
$lnk.IconLocation     = "$IconPath,0"
$lnk.Description      = 'Studio Hub - library of titles where you have both the script and the movie'
$lnk.WindowStyle      = 7
$lnk.Save()

Write-Host "[ok] Shortcut placed on Desktop: $LinkName"
