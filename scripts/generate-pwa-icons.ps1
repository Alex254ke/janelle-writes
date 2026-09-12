param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\assets\pwa')
)

Add-Type -AssemblyName System.Drawing

function New-JanelleIcon {
  param(
    [int]$Size,
    [string]$Path,
    [bool]$Maskable = $false
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::FromArgb(15, 25, 35))

  $bounds = [System.Drawing.RectangleF]::new(0, 0, $Size, $Size)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $bounds,
    [System.Drawing.Color]::FromArgb(15, 25, 35),
    [System.Drawing.Color]::FromArgb(23, 68, 84),
    45
  )
  $graphics.FillRectangle($gradient, $bounds)

  $safeScale = if ($Maskable) { 0.68 } else { 0.78 }
  $fontSize = [single]($Size * $safeScale)
  $font = [System.Drawing.Font]::new('Georgia', $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $letterBounds = [System.Drawing.RectangleF]::new(0, [single](-$Size * 0.035), $Size, $Size)
  $graphics.DrawString('J', $font, [System.Drawing.Brushes]::White, $letterBounds, $format)

  $accentScale = if ($Maskable) { 0.14 } else { 0.17 }
  $accentOffset = if ($Maskable) { 0.65 } else { 0.73 }
  $accentSize = [single]($Size * $accentScale)
  $accentX = [single]($Size * $accentOffset)
  $accentY = [single]($Size * $accentOffset)
  $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 157, 143))
  $graphics.FillEllipse($accentBrush, $accentX, $accentY, $accentSize, $accentSize)

  $directory = Split-Path -Parent $Path
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $accentBrush.Dispose()
  $format.Dispose()
  $font.Dispose()
  $gradient.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-JanelleIcon -Size 192 -Path (Join-Path $resolvedOutput 'icon-192.png')
New-JanelleIcon -Size 512 -Path (Join-Path $resolvedOutput 'icon-512.png')
New-JanelleIcon -Size 512 -Path (Join-Path $resolvedOutput 'icon-maskable-512.png') -Maskable $true
New-JanelleIcon -Size 180 -Path (Join-Path $resolvedOutput 'apple-touch-icon.png')
