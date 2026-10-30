param(
  [Parameter(Mandatory)][string]$ZipPath,
  [Parameter(Mandatory)][string]$EntryName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($EntryName -notmatch '^[A-Za-z0-9._-]+\.(?i:jpg|jpeg|png)$') { throw 'Nombre de imagen no permitido.' }
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $entry = $zip.GetEntry($EntryName)
  if (-not $entry) { throw 'Imagen no encontrada en el ZIP.' }
  if ($entry.Length -gt 10MB) { throw 'Imagen demasiado grande para la vista local.' }
  $stream = $entry.Open()
  $buffer = [byte[]]::new([int]$entry.Length)
  try {
    $offset = 0
    while ($offset -lt $buffer.Length) {
      $count = $stream.Read($buffer, $offset, $buffer.Length - $offset)
      if ($count -eq 0) { throw 'Imagen incompleta en el ZIP.' }
      $offset += $count
    }
  } finally { $stream.Dispose() }
  [Console]::OpenStandardOutput().Write($buffer, 0, $buffer.Length)
} finally { $zip.Dispose() }
