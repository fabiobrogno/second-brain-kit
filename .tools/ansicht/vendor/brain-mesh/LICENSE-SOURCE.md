# Herkunft und Lizenz der Gehirnoberfläche

**Datei:** `vendor/brain-mesh/brain-mesh.js` (≈2,8 MB), erzeugt von `.tools/ansicht/build/build-brain.mjs`.

## Quelle
- **Datensatz:** AOMIC-ID1000 — *The Amsterdam Open MRI Collection*, OpenNeuro **ds003097**, Version 1.2.1
- **DOI:** https://doi.org/10.18112/openneuro.ds003097.v1.2.1
- **Seite:** https://openneuro.org/datasets/ds003097 · Projekt: https://nilab-uva.github.io/AOMIC.github.io/
- **Verwendete Dateien** (FreeSurfer-Ableitungen, Proband `sub-0001`), abgerufen am 02.10.2026 von
  `https://s3.amazonaws.com/openneuro.org/ds003097/derivatives/freesurfer/sub-0001/`:
  `surf/lh.pial`, `surf/rh.pial`, `surf/lh.sulc`, `surf/rh.sulc`, `surf/lh.curv`, `surf/rh.curv`,
  `label/lh.aparc.annot`, `label/rh.aparc.annot`, `mri/aseg.mgz`
- **Autoren:** Lukas Snoek, Maite van der Miesen, Andries van der Leij, Tinka Beemsterboer, Annemarie Eigenhuis,
  H. Steven Scholte (Universiteit van Amsterdam)
- **Publikation:** Snoek, L. et al. (2021). *The Amsterdam Open MRI Collection, a set of multimodal MRI datasets for
  individual difference analyses.* Scientific Data 8, 85. https://doi.org/10.1038/s41597-021-00870-6

## Lizenz
**CC0 1.0 Universal (Public Domain Dedication)** — https://creativecommons.org/publicdomain/zero/1.0/

Beleg: `dataset_description.json` des Datensatzes enthält wörtlich `"License": "CC0"`
(https://s3.amazonaws.com/openneuro.org/ds003097/dataset_description.json); die Publikation nennt ID1000 ebenfalls
als CC0. CC0 erlaubt Nutzung, Veränderung und Weitergabe ohne Bedingungen — auch in einem öffentlichen MIT-Repo.
Namensnennung ist nicht Pflicht, wird hier aber aus Höflichkeit gegeben (die Autoren bitten in `HowToAcknowledge`
um Zitation der Publikation).

## Was abgeleitet wurde
Keine Bilddaten, keine personenbezogenen Daten: nur die rekonstruierte Kortexoberfläche (Geometrie), Sulkustiefe und
Kurvatur (für die Schattierung), die automatische Lappen-Parzellierung (Desikan-Killiany, `aparc`) und aus der
Volumen-Segmentierung Kleinhirn und Hirnstamm (per Marching Cubes) sowie ein grobes 64³-Belegungsraster.
Die Punkte werden flächengewichtet abgetastet, quantisiert (16 Bit Position, 2 Byte Normale) und base64-kodiert.

**Nicht verwendet:** FreeSurfer-`fsaverage`, BodyParts3D, NIH-3D-Modelle mit BY/BY-SA/BY-NC-Lizenz
(z. B. 3DPX-003765 = CC BY-SA, 3DPX-000320 = CC BY-NC-SA). Die genutzten Dateien sind Ausgaben eines
FreeSurfer-Laufs über CC0-Daten; FreeSurfer selbst wird nicht mitgeliefert oder benötigt (eigene Leser in `build/fs-read.mjs`).

## Neu bauen
```
node .tools/ansicht/build/build-brain.mjs            # lädt die 9 Dateien (~13 MB) einmalig in einen Cache im Temp-Ordner
BRAIN_DENSITY=1.2 node .tools/ansicht/build/build-brain.mjs   # mehr Punkte
BRAIN_PITCH=11 node .tools/ansicht/build/build-brain.mjs      # Ausgleich der Kopfneigung (Grad)
```
