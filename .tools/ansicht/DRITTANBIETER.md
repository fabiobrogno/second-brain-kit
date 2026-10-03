# Drittanbieter in der 3D-Ansicht (`.tools/ansicht/`)

Die Ansicht läuft vollständig lokal (auch über `file://`), ohne CDN. Mitgeliefert werden vier fremde Bestandteile:

| Bestandteil | Datei(en) | Lizenz | Quelle |
|---|---|---|---|
| three.js r170 (gebündelt mit OrbitControls, EffectComposer, UnrealBloomPass, OutputPass, MarchingCubes) | `vendor/three.bundle.js` | MIT | https://github.com/mrdoob/three.js · Lizenztext: `vendor/three.LICENSE.txt` |
| Geist / Geist Mono (Schriften) | `vendor/fonts/Geist-Variable.woff2`, `vendor/fonts/GeistMono-Variable.woff2` | SIL Open Font License 1.1 | https://github.com/vercel/geist-font · Lizenztext: `vendor/fonts/OFL.txt` |
| Gehirnoberfläche (abgeleitet aus MRT-Daten AOMIC-ID1000, OpenNeuro ds003097, sub-0001) | `vendor/brain-mesh/brain-mesh.js` | CC0 1.0 (gemeinfrei) | https://openneuro.org/datasets/ds003097 · DOI https://doi.org/10.18112/openneuro.ds003097.v1.2.1 · Herkunft: `vendor/brain-mesh/LICENSE-SOURCE.md` |
| MCP-Logos (Simple Icons, Version 16.33.0, 46 Symbole) | `vendor/icons/*.svg`, `vendor/icons/zuordnung.json` | CC0 1.0 (gemeinfrei) | https://github.com/simple-icons/simple-icons · Lizenztext + Monogramm-Fälle: `vendor/icons/LIZENZ.md` |

## MCP-Logos — CC0 1.0 Universal (Simple Icons)

Die Symbole unter `vendor/icons/` stammen aus Simple Icons (Version 16.33.0, gepinnt), vollständig unter
CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). CC0 gilt für die SVG-Zeichnungen — die
dargestellten Markennamen und -logos bleiben Marken ihrer jeweiligen Inhaber; die Nutzung hier dient
ausschließlich der Kennzeichnung von MCP-Servern in der eigenen, lokalen Ansicht. Marken, die Simple Icons
inzwischen entfernt hat (u. a. Microsoft, Slack, Canva, Klaviyo, OpenAI, Playwright, Amazon, Salesforce,
Twilio), bekommen statt eines Logos ein Monogramm — Details und vollständige Liste: `vendor/icons/LIZENZ.md`.
Zur Laufzeit lädt die Ansicht die SVGs per `fetch` ausschließlich vom eigenen Ursprung (CSP `img-src 'self'
data:`), nie von einem fremden Host.

## Gehirnoberfläche — CC0 1.0 Universal

Der Datensatz AOMIC-ID1000 (Snoek, L. et al. (2021), *The Amsterdam Open MRI Collection*, Scientific Data 8, 85,
https://doi.org/10.1038/s41597-021-00870-6) steht unter CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/):
Nutzung, Veränderung und Weitergabe ohne Bedingungen. Abgeleitet wurden nur Geometrie, Sulkustiefe/Kurvatur und die
Lappen-Zuordnung — keine Bilddaten, keine personenbezogenen Daten. Neu bauen: `node .tools/ansicht/build/build-brain.mjs`
(Download-Cache unter dem Temp-Ordner des Systems, nie im Repo). Details in `vendor/brain-mesh/LICENSE-SOURCE.md`.

## three.js — MIT-Lizenz (vollständiger Text aus `vendor/three.LICENSE.txt`)

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Geist und Geist Mono — SIL Open Font License 1.1 (vollständiger Text aus `vendor/fonts/OFL.txt`)

```
Copyright (c) 2023 Vercel, in collaboration with basement.studio

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
