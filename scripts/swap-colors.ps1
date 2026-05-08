param([string]$Root = "artifacts\voycelab-landing\src", [string]$Exclude = "tokens.ts")
$ErrorActionPreference = 'Stop'
$files = Get-ChildItem -Path $Root -Recurse -Include *.tsx,*.ts -File | Where-Object { $_.Name -ne $Exclude }
$map = @(
  @('rgba\(255,\s*201,\s*168', 'rgba(251, 207, 232'),
  @('rgba\(255,\s*222,\s*200', 'rgba(224, 231, 255'),
  @('rgba\(255,\s*169,\s*138', 'rgba(165, 180, 252'),
  @('rgba\(199,\s*183,\s*229', 'rgba(199, 210, 254'),
  @('rgba\(156,\s*201,\s*161', 'rgba(167, 243, 208'),
  @('rgba\(255,\s*107,\s*71',  'rgba(99, 102, 241'),
  @('rgba\(255,\s*138,\s*102', 'rgba(236, 72, 153'),
  @('rgba\(237,\s*83,\s*49',   'rgba(79, 70, 229'),
  @('rgba\(251,\s*247,\s*241', 'rgba(255, 255, 255'),
  @('rgba\(244,\s*236,\s*221', 'rgba(250, 250, 249'),
  @('rgba\(14,\s*27,\s*44',    'rgba(10, 10, 11'),
  @('#FFC9A8','#FBCFE8'), @('#FFE4D2','#FCE7F3'),
  @('#C7B7E5','#C7D2FE'), @('#EDE5F8','#E0E7FF'),
  @('#9CC9A1','#A7F3D0'), @('#DCEBDB','#D1FAE5'),
  @('#F2C97D','#FDE68A'), @('#FBE8C0','#FEF3C7'),
  @('#FF6B47','#0A0A0B'), @('#FF7E5C','#1F1F23'),
  @('#ED5331','#000000'), @('#E2502E','#000000'),
  @('#FFA384','#A5B4FC'), @('#FFF1EB','#EEF2FF'),
  @('#FBF7F1','#FFFFFF'), @('#F4ECDD','#FAFAF9'),
  @('#ECE0CB','#F4F4F5'),
  @('#0E1B2C','#0A0A0B'), @('#2B3A50','#27272A'),
  @('#5A6577','#71717A'), @('#8A93A2','#A1A1AA'),
  @('#1A2638','#18181B'), @('#243042','#27272A'),
  @('#2E3A4D','#3F3F46')
)
$total = 0
foreach ($f in $files) {
  $orig = Get-Content $f.FullName -Raw
  $text = $orig
  foreach ($pair in $map) {
    $text = $text -replace $pair[0], $pair[1]
  }
  if ($text -ne $orig) {
    Set-Content -Path $f.FullName -Value $text -NoNewline
    $total++
    Write-Host "Updated: $($f.FullName.Substring($PWD.Path.Length+1))"
  }
}
Write-Host "Total files updated: $total"
