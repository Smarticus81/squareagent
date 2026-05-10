$files = @(
  'artifacts/voycelab-landing/src/pages/assistants.tsx',
  'artifacts/voycelab-landing/src/pages/landing.tsx',
  'artifacts/voycelab-landing/src/pages/command.tsx',
  'artifacts/voycelab-landing/src/pages/create-assistant.tsx',
  'artifacts/voycelab-landing/src/pages/settings.tsx',
  'artifacts/voycelab-landing/src/components/layout.tsx',
  'artifacts/voycelab-landing/src/components/voice-orb.tsx'
)
$map = [ordered]@{
  'h-\[380px\]'   = 'h-95'
  'h-\[460px\]'   = 'h-115'
  'h-\[420px\]'   = 'h-105'
  'h-\[480px\]'   = 'h-120'
  'h-\[64px\]'    = 'h-16'
  'sm:h-\[72px\]' = 'sm:h-18'
  'pt-\[64px\]'   = 'pt-16'
  'sm:pt-\[72px\]'= 'sm:pt-18'
  'w-\[560px\]'   = 'w-140'
  'w-\[680px\]'   = 'w-170'
  'w-\[600px\]'   = 'w-150'
  'w-\[620px\]'   = 'w-155'
  'max-w-\[1180px\]' = 'max-w-295'
  'max-w-\[1160px\]' = 'max-w-290'
  'max-w-\[1280px\]' = 'max-w-7xl'
  'max-w-\[960px\]'  = 'max-w-240'
  'max-w-\[720px\]'  = 'max-w-180'
  'max-w-\[640px\]'  = 'max-w-160'
  'max-w-\[620px\]'  = 'max-w-155'
  'max-w-\[460px\]'  = 'max-w-115'
  'max-w-\[440px\]'  = 'max-w-110'
  'max-w-\[340px\]'  = 'max-w-85'
  'max-w-\[300px\]'  = 'max-w-75'
  'max-h-\[190px\]'  = 'max-h-47.5'
  'gap-\[2px\]' = 'gap-0.5'
  'gap-\[3px\]' = 'gap-0.75'
  'w-\[2px\]'   = 'w-0.5'
  'w-\[3px\]'   = 'w-0.75'
  'border-black/\[0\.06\]'   = 'border-black/6'
  'hover:bg-black/\[0\.02\]' = 'hover:bg-black/2'
  'focus-visible:ring-\[color:var\(--color-vl-accent\)\]' = 'focus-visible:ring-(--color-vl-accent)'
  'group-hover:text-\[color:var\(--color-vl-ink\)\]'      = 'group-hover:text-(--color-vl-ink)'
  '\bflex-shrink\b' = 'shrink'
}
foreach ($f in $files) {
  if (-not (Test-Path $f)) { Write-Host "skip: $f"; continue }
  $orig = Get-Content -Raw $f
  $new = $orig
  foreach ($k in $map.Keys) { $new = [regex]::Replace($new, $k, $map[$k]) }
  if ($new -ne $orig) {
    Set-Content -Path $f -Value $new -NoNewline
    Write-Host "updated: $f"
  } else {
    Write-Host "no-change: $f"
  }
}
