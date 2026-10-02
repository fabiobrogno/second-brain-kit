# bootstrap.ps1 — Einsteiger-Weg ohne Admin-Rechte (Windows): Node besorgen, Kit laden, install.mjs starten.
# Alles Fehleranfällige läuft in EINEM try/catch: kein rohes PowerShell-/Werkzeug-Fehlerbild darf das
# Terminal erreichen, nur der eine Alltagssatz aus dem catch-Block (Details gehen ins Log).
# [Environment]::GetFolderPath('MyDocuments') ist der ECHTE Dokumente-Ordner — berücksichtigt auch
# OneDrive-Umleitung; Join-Path $env:USERPROFILE "Dokumente\Brain" wäre ein zweiter, falscher Ordner
# (Explorer zeigt den echten Ordner nur lokalisiert als "Dokumente" AN, er heißt "Documents").
param([string]$Ziel = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) "Brain"), [string]$Backup = "keins", [string]$Version = "")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = $env:BRAIN_KIT_VERSION; if (-not $Version) { $Version = "v0.1.0" } }
$Heim = $env:BRAIN_KIT_HOME; if (-not $Heim) { $Heim = Join-Path $env:USERPROFILE ".brain-kit" }
$Log = Join-Path $Heim "install.log"
function Melde($Text) { Write-Host $Text; try { Add-Content -Path $Log -Value $Text -ErrorAction Stop } catch {} }

try {
  New-Item -ItemType Directory -Force -Path $Heim | Out-Null
  "--- bootstrap $(Get-Date) ---" | Out-File -Append $Log
  Melde "Ich richte dein Second Brain ein, das dauert ein paar Minuten."

  $NodeOk = $false
  $NodeExe = Get-Command node -ErrorAction SilentlyContinue
  if ($NodeExe) { $Maj = [int](& node -e "console.log(process.versions.node.split('.')[0])"); if ($Maj -ge 20) { $NodeOk = $true } }
  if (-not $NodeOk) {
    Melde "Ich lade Node (die Technik dahinter) für dich herunter ..."
    New-Item -ItemType Directory -Force -Path (Join-Path $Heim "node") | Out-Null
    if ($env:BRAIN_KIT_NODE_QUELLE) {
      Copy-Item $env:BRAIN_KIT_NODE_QUELLE (Join-Path $Heim "node\node.exe") -Force
    } else {
      $Arch = "x64"; if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $Arch = "arm64" }
      $NodeV = "22.11.0"; $Name = "node-v$NodeV-win-$Arch"
      Invoke-WebRequest "https://nodejs.org/dist/v$NodeV/$Name.zip" -OutFile (Join-Path $Heim "$Name.zip") -UseBasicParsing
      Invoke-WebRequest "https://nodejs.org/dist/v$NodeV/SHASUMS256.txt" -OutFile (Join-Path $Heim "SHASUMS256.txt") -UseBasicParsing
      $Sum = (Get-FileHash (Join-Path $Heim "$Name.zip") -Algorithm SHA256).Hash.ToLower()
      $Zeile = Select-String -Path (Join-Path $Heim "SHASUMS256.txt") -SimpleMatch "$Name.zip" | Select-Object -First 1
      if (-not $Zeile -or -not $Zeile.Line.ToLower().StartsWith($Sum)) { throw "Node-Prüfsumme stimmt nicht" }
      Expand-Archive (Join-Path $Heim "$Name.zip") -DestinationPath (Join-Path $Heim "node-tmp") -Force
      Move-Item (Join-Path $Heim "node-tmp\$Name\*") (Join-Path $Heim "node") -Force
    }
  }
  $env:PATH = (Join-Path $Heim "node") + ";" + $env:PATH

  $Archiv = $env:BRAIN_KIT_ARCHIV
  if (-not $Archiv) {
    Melde "Ich lade das Second-Brain-Kit herunter ..."
    $Archiv = Join-Path $Heim "kit-$Version.tar.gz"
    Invoke-WebRequest "https://github.com/fbrogno/second-brain-kit/archive/refs/tags/$Version.tar.gz" -OutFile $Archiv -UseBasicParsing
  }
  $KitDir = Join-Path $Heim "kit\$Version"
  New-Item -ItemType Directory -Force -Path $KitDir | Out-Null
  & tar.exe -xzf $Archiv -C $KitDir --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "Kit-Archiv entpacken fehlgeschlagen (tar.exe: $LASTEXITCODE)" }

  Melde "Ich richte dein Brain ein ..."
  & node (Join-Path $KitDir "install.mjs") $Ziel --agent auto --profil auto --sprache auto --backup $Backup
  if ($LASTEXITCODE -ne 0) { throw "Installation fehlgeschlagen (node: $LASTEXITCODE)" }
} catch {
  Write-Host "Die Einrichtung hat nicht geklappt — Details stehen in $Log. Sag deiner KI: „Die Brain-Installation ist fehlgeschlagen, schau ins Log.“"
  try { Add-Content -Path $Log -Value $_ -ErrorAction Stop } catch {}
  exit 1
}
