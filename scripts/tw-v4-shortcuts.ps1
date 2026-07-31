$files = @(
  'artifacts/voycelab-landing/src/pages/assistants.tsx',
  'artifacts/voycelab-landing/src/pages/landing.tsx',
  'artifacts/voycelab-landing/src/pages/command.tsx',
  'artifacts/voycelab-landing/src/pages/create-assistant.tsx',
  'artifacts/voycelab-landing/src/pages/settings.tsx',
  'artifacts/voycelab-landing/src/pages/connected-services.tsx',
  'artifacts/voycelab-landing/src/pages/data-sources.tsx',
  'artifacts/voycelab-landing/src/pages/pricing.tsx',
  'artifacts/voycelab-landing/src/pages/signup.tsx',
  'artifacts/voycelab-landing/src/pages/login.tsx',
  'artifacts/voycelab-landing/src/components/layout.tsx',
  'artifacts/voycelab-landing/src/components/voice-orb.tsx',
  'artifacts/voycelab-landing/src/components/ui/toast.tsx'
)
$map = [ordered]@{
  'h-\[360px\]'   = 'h-90'
  'h-\[380px\]'   = 'h-95'
  'h-\[460px\]'   = 'h-115'
  'h-\[420px\]'   = 'h-105'
  'h-\[480px\]'   = 'h-120'
  'h-\[64px\]'    = 'h-16'
  'sm:h-\[72px\]' = 'sm:h-18'
  'pt-\[64px\]'   = 'pt-16'
  'sm:pt-\[72px\]'= 'sm:pt-18'
  'w-\[520px\]'   = 'w-130'
  'w-\[560px\]'   = 'w-140'
  'w-\[640px\]'   = 'w-160'
  'w-\[680px\]'   = 'w-170'
  'w-\[600px\]'   = 'w-150'
  'w-\[620px\]'   = 'w-155'
  'max-w-\[1180px\]' = 'max-w-295'
  'max-w-\[1160px\]' = 'max-w-290'
  'max-w-\[1280px\]' = 'max-w-7xl'
  'max-w-\[960px\]'  = 'max-w-240'
  'max-w-\[680px\]'  = 'max-w-170'
  'max-w-\[720px\]'  = 'max-w-180'
  'max-w-\[640px\]'  = 'max-w-160'
  'max-w-\[620px\]'  = 'max-w-155'
  'max-w-\[520px\]'  = 'max-w-130'
  'max-w-\[460px\]'  = 'max-w-115'
  'max-w-\[440px\]'  = 'max-w-110'
  'max-w-\[420px\]'  = 'max-w-105'
  'md:max-w-\[420px\]' = 'md:max-w-105'
  'max-w-\[340px\]'  = 'max-w-85'
  'max-w-\[300px\]'  = 'max-w-75'
  'min-h-\[36px\]'   = 'min-h-9'
  'max-h-\[190px\]'  = 'max-h-47.5'
  'right-\[-40px\]'  = '-right-10'
  'top-\[-50px\]'    = '-top-12.5'
  'gap-\[2px\]' = 'gap-0.5'
  'gap-\[3px\]' = 'gap-0.75'
  'w-\[2px\]'   = 'w-0.5'
  'w-\[3px\]'   = 'w-0.75'
  'border-black/\[0\.06\]'   = 'border-black/6'
  'border-black/\[0\.12\]'   = 'border-black/12'
  'divide-black/\[0\.06\]'   = 'divide-black/6'
  'hover:bg-black/\[0\.02\]' = 'hover:bg-black/2'
  'hover:bg-black/\[0\.04\]' = 'hover:bg-black/4'
  'hover:border-black/\[0\.25\]' = 'hover:border-black/25'
  'bg-\[var\(--color-vl-cream\)\]/50' = 'bg-(--color-vl-cream)/50'
  'bg-\[color:var\(--color-vl-ink\)\]' = 'bg-(--color-vl-ink)'
  'focus-visible:ring-\[color:var\(--color-vl-accent\)\]' = 'focus-visible:ring-(--color-vl-accent)'
  'text-\[color:var\(--color-vl-ink\)\]' = 'text-(--color-vl-ink)'
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
