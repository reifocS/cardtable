# Cardtable

A realtime table for any card game. Import a deck, share the table code, hop in voice, play.
No rules engine: players move cards and make the calls themselves, like at a real table.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

## How it fits together

- `src/core/`: game-agnostic, framework-free TypeScript.
  - `types.ts`: cards, zones, players. A game is a `Preset`: which zones each player gets, which trackers, which
    zones play the deck, hand, play area and discard, where deck-list sections go, and optional commander rules.
    The engine names no zone itself; Magic is just the built-in preset (`state.ts`).
  - `ops.ts`: every action is a serializable `Op`; `apply()` is pure and writes the log.
  - `visibility.ts`: who may see which card; `redact()` strips the rest before anything is sent.
  - `engine.ts`: the authoritative game on the host, with per-op undo.
- `src/net/`: PeerJS (WebRTC). The host tab runs the engine and sends each peer only its redacted view.
  Clients predict simple ops locally so drags feel instant.
- `src/cards/`: decklist parsing and Scryfall lookups. Lines like `2 Name | https://image.url` work for any game.
- `src/ui/`: React, DOM rendering. Card positions on a battlefield are proportional, and cards are sized from the board's height, so every screen shows the same layout with cards as big as it allows (`ui/fit.ts`).

Two tabs on one machine act as two players, which is handy for testing.

### Dev presets

In `npm run dev`, the lobby lists ready-made tables (empty, duel, 4-player Commander, crowded board,
six players, text-only cards, open library search, zoomed opponent board) to check the UI for visual
regressions in a click. `?preset=<id>` (e.g. `?preset=commander4`) loads one directly, so a reload
reopens it. They are built with the real ops from a fixed seed, never saved, and left out of
production builds. See `src/dev/presets.ts`.

## Credits

Icons by Lorc, Delapouite, Catsu, Faithtoken, Quoting and Sbed from [game-icons.net](https://game-icons.net), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
Card data and images from [Scryfall](https://scryfall.com). Font: [Grenze](https://fonts.google.com/specimen/Grenze).

## License

[MIT](LICENSE). Icons and fonts keep their own licenses (see Credits).
