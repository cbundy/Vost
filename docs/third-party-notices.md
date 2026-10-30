# Third-party notices

Vost itself is MIT licensed (see [LICENSE](../LICENSE)). The pictures of the Icons, Emojis and Stickers drawing tools are bundled from the open sets below, as curated subsets stored in `client/src/lib/iconSets/`. They are loaded only when the picker opens or a stored picture is drawn, and nothing is fetched from the internet.

## Lucide icons

- Used for: the **Icons** tool (`client/src/lib/iconSets/icons.ts`), converted to SVG path data.
- Source: <https://lucide.dev>, package `lucide-static` 1.65.0 (<https://github.com/lucide-icons/lucide>).
- Licence: ISC (<https://github.com/lucide-icons/lucide/blob/main/LICENSE>), with MIT for the icons derived from Feather.
- Notice: "ISC License. Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS." The icons Lucide lists as derived from the Feather project are under the MIT licence, "Copyright (c) 2013-present Cole Bemis" (the full text is in the `LICENSE` file of the `lucide-static` package and in the repository linked above).

## Twemoji (jdecked fork)

- Used for: the **Emojis** tool (`client/src/lib/iconSets/emojis.ts`), full-colour SVG graphics.
- Source: <https://github.com/jdecked/twemoji>, package `@twemoji/svg` 15.0.0. The original Twemoji was created by Twitter, Inc.
- Licence: graphics CC-BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>).
- Attribution: "Twemoji graphics, Copyright 2020 Twitter, Inc and other contributors (https://github.com/twitter/twemoji), maintained by jdecked (https://github.com/jdecked/twemoji), licensed under CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: a curated subset, kept as the original SVG."
- Emoji names and search keywords come from the OpenMoji emoji data (<https://github.com/hfg-gmuend/openmoji>, `data/openmoji.json`, built on the Unicode CLDR annotations, licence: CC-BY-SA 4.0 and the Unicode licence).

## OpenMoji

- Used for: the **Stickers** tool (`client/src/lib/iconSets/stickers.ts`), full-colour SVG art.
- Source: <https://openmoji.org>, package `openmoji` 17.0.0 (<https://github.com/hfg-gmuend/openmoji>).
- Licence: CC-BY-SA 4.0 (<https://creativecommons.org/licenses/by-sa/4.0/>).
- Attribution: "All emojis designed by OpenMoji - the open-source emoji and icon project. License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Changes: a curated subset; comments and whitespace removed from the SVG files."
- Share-alike: the OpenMoji artwork in `client/src/lib/iconSets/stickers.ts` stays under CC-BY-SA 4.0, separately from the MIT licence of the rest of Vost.
