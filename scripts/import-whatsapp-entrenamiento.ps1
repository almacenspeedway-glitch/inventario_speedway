param(
  [string]$SourceFile = (Join-Path $PSScriptRoot '..\registro_del_inventario_whatsapp\WhatsApp_chat_entrenamiento.zip'),
  [string]$OutputFile = (Join-Path $PSScriptRoot '..\work\importaciones\entrenamiento-revision.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

function Get-Sha256([string]$Value) {
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant()
}

function Get-Expiry([string]$Body) {
  if ($Body -match '(?i)\bvence\s*:?\s*(?<m>\d{1,2})/(?<y>\d{2,4})\b') {
    $month = [int]$Matches.m; $year = [int]$Matches.y
    if ($year -lt 100) { $year += 2000 }
    $raw = $Matches[0]
    if ($month -ge 1 -and $month -le 12) {
      return @{ raw = $raw; iso = ('{0:D4}-{1:D2}' -f $year,$month); precision = 'mes'; issue = $null }
    }
    return @{ raw = $raw; iso = $null; precision = 'mes'; issue = 'Mes inválido' }
  }
  return @{ raw = $null; iso = $null; precision = $null; issue = $null }
}

$source = Get-Item -LiteralPath $SourceFile
$zip = [IO.Compression.ZipFile]::OpenRead($source.FullName)
try {
  $chatEntry = $zip.GetEntry('_chat.txt')
  if (-not $chatEntry) { throw 'Este importador espera _chat.txt en el ZIP.' }
  if ($chatEntry.Length -gt 10MB) { throw 'El TXT excede el límite de 10 MB.' }
  $reader = [IO.StreamReader]::new($chatEntry.Open(), [Text.Encoding]::UTF8, $true)
  try { $chat = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $imageEntries = @($zip.Entries | Where-Object { $_.FullName -match '(?i)\.(jpe?g|png|webp)$' -and $_.Length -gt 0 })
  $photoEntries = @($imageEntries | Where-Object { $_.FullName -match '(?i)\.(jpe?g|png)$' })
  $imageNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $imageEntries) { [void]$imageNames.Add($entry.FullName) }
  $allEntryNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $zip.Entries) { [void]$allEntryNames.Add($entry.FullName) }
} finally { $zip.Dispose() }

# El export de iPhone usa marcas invisibles y espacios de no separación.
$chat = $chat -replace '[\u200E\u200F]', '' -replace '[\u202F\u00A0]', ' ' -replace '\r', ''
$blocks = [regex]::Split($chat, '(?m)(?=^\[\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}:\d{2} [ap]\. m\.\])')
$records = [Collections.Generic.List[object]]::new()
$seen = @{}
$allReferences = 0; $matchedReferences = 0; $missingReferences = 0
foreach ($block in $blocks) {
  $match = [regex]::Match($block.Trim(), '(?s)^\[(?<stamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}:\d{2} [ap]\. m\.)\] (?<author>[^:\n]+):\s*(?<body>.*)$')
  if (-not $match.Success) { continue }
  $stamp = $match.Groups['stamp'].Value
  $author = $match.Groups['author'].Value.Trim()
  $body = $match.Groups['body'].Value.Trim()
  $references = @([regex]::Matches($body, '(?i)<adjunto:\s*(?<name>[^>]+)>') | ForEach-Object { $_.Groups['name'].Value.Trim() })
  $photos = [Collections.Generic.List[string]]::new()
  foreach ($name in $references) {
    $allReferences++
    if ($allEntryNames.Contains($name)) {
      $matchedReferences++
      if ($imageNames.Contains($name) -and $name -match '(?i)\.(jpe?g|png)$') { $photos.Add($name) }
    } else { $missingReferences++ }
  }
  $hasSticker = @($references | Where-Object { $_ -match '(?i)\.webp$' }).Count -gt 0
  $quantity = $null; $unit = $null
  if ($body -match '(?i)\b(?<q>\d+)\s*(?<u>unidad(?:es)?|unidas|unid(?:ades)?|und(?:s)?)\b') {
    $quantity = [int]$Matches.q; $unit = 'unidad'
  } elseif ($body -match '(?i)\b(?<q>una|uno|un|dos|tres|cuatro|cinco)\s+unidad(?:es)?\b') {
    $quantity = @{ una=1; uno=1; un=1; dos=2; tres=3; cuatro=4; cinco=5 }[$Matches.q.ToLowerInvariant()]; $unit = 'unidad'
  } elseif ($body -match '(?i)\b(?<q>uno|una|un)\s+para\s+stock\b') {
    $quantity = 1; $unit = 'unidad'
  }
  $kind = if ($body -match '(?i)\bentra\s+y\s+sale\b') { 'operacion_ambigua' }
    elseif ($body -match '(?i)\b(salida|sale|salen|salio|salió|salen)\b|\bdale\s+de\s+stock\b') { 'salida' }
    elseif ($body -match '(?i)\b(entrada|entra|ingresa|llegaron)\b') { 'entrada' }
    else { 'conteo_probable' }
  $candidate = $photos.Count -gt 0 -or ($null -ne $quantity -and $body -match '(?i)\b(stock|salida|sale|salen|entra|entrada|quedan|inventario|vence)\b')
  if ($hasSticker -and $photos.Count -eq 0 -and $null -eq $quantity) { $candidate = $false }
  $expiry = Get-Expiry $body
  $flags = [Collections.Generic.List[string]]::new()
  if ($candidate) {
    if ($photos.Count -eq 0) { $flags.Add('sin_foto_vinculada') }
    if ($null -eq $quantity) { $flags.Add('cantidad_no_indicada') }
    if ($kind -eq 'conteo_probable') { $flags.Add('tipo_inferido_del_contexto') }
    if ($kind -eq 'operacion_ambigua') { $flags.Add('entrada_y_salida_en_mismo_mensaje') }
    $flags.Add('producto_pendiente_de_revisión')
  }
  $normalizedStamp = $stamp.Replace('a. m.','AM').Replace('p. m.','PM')
  $date = [datetime]::ParseExact($normalizedStamp, 'd/M/yy, h:mm:ss tt', [Globalization.CultureInfo]::InvariantCulture)
  $keyBase = Get-Sha256 "$stamp`n$author`n$body"
  if (-not $seen.ContainsKey($keyBase)) { $seen[$keyBase] = 0 }
  $seen[$keyBase]++
  $id = (Get-Sha256 "$keyBase`n$($seen[$keyBase])").Substring(0,16)
  $safeAuthor = if ($author -match '^\+|\d{7,}') { 'Contacto ' + (Get-Sha256 $author).Substring(0,6) } else { $author }
  $records.Add([ordered]@{
    id = $id
    timestamp = $date.ToString('yyyy-MM-ddTHH:mm:ss') + '-05:00'
    author = $safeAuthor
    text = $body
    imageOmitted = $false
    photos = @($photos.ToArray())
    candidate = [bool]$candidate
    kind = $kind
    quantity = $quantity
    unit = $unit
    unitsPerPack = $null
    product = $null
    lot = $null
    expiry = $expiry
    flags = @($flags.ToArray())
    status = if ($candidate) { 'pendiente' } else { 'informativo' }
  })
}
$candidates = @($records | Where-Object { $_.candidate })
$summary = [ordered]@{
  messages = $records.Count
  candidates = $candidates.Count
  omittedImages = 0
  mediaFiles = $imageEntries.Count
  photoFiles = $photoEntries.Count
  stickerFiles = $imageEntries.Count - $photoEntries.Count
  linkedPhotoMessages = @($candidates | Where-Object { $_.photos.Count -gt 0 }).Count
  attachmentReferences = $allReferences
  attachmentMatches = $matchedReferences
  attachmentMissing = $missingReferences
  withoutQuantity = @($candidates | Where-Object { $null -eq $_.quantity }).Count
  explicitExits = @($candidates | Where-Object { $_.kind -eq 'salida' }).Count
  expiryPresent = @($candidates | Where-Object { $_.expiry.raw }).Count
  expiryAmbiguous = @($candidates | Where-Object { $_.expiry.issue }).Count
  namedProducts = 0
  confirmedStock = 0
}
$output = [ordered]@{
  schemaVersion = 1
  dataset = 'entrenamiento'
  source = [ordered]@{
    fileName = $source.Name
    sha256 = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    importedAt = [datetime]::UtcNow.ToString('o')
    chatEntry = $chatEntry.FullName
    note = 'Chat histórico de entrenamiento. Las fotos se vinculan exclusivamente por nombre de adjunto escrito en el mensaje. No equivale al conteo de apertura del 29 de octubre.'
  }
  summary = $summary
  records = @($records.ToArray())
}
$target = [IO.Path]::GetFullPath($OutputFile)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
[IO.File]::WriteAllText($target, ($output | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Output "Mensajes: $($summary.messages) | Candidatos: $($summary.candidates) | Fotos JPG/PNG: $($summary.photoFiles)"
Write-Output "Referencias adjuntas: $allReferences | Coinciden con ZIP: $matchedReferences | Ausentes: $missingReferences"
Write-Output "Candidatos con foto vinculada: $($summary.linkedPhotoMessages) | Salidas explícitas: $($summary.explicitExits)"
Write-Output "Archivo de revisión: $target"
