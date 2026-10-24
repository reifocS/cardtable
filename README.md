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
  - `types.ts`: cards, zones, players. A game is a `Preset` (which zones each player gets, which trackers).
  - `ops.ts`: every action is a serializable `Op`; `apply()` is pure and writes the log.
  - `visibility.ts`: who may see which card; `redact()` strips the rest before anything is sent.
  - `engine.ts`: the authoritative game on the host, with per-op undo.
- `src/net/`: PeerJS (WebRTC). The host tab runs the engine and sends each peer only its redacted view.
  Clients predict simple ops locally so drags feel instant.
- `src/cards/`: decklist parsing and Scryfall lookups. Lines like `2 Name | https://image.url` work for any game.
- `src/ui/`: React, DOM rendering. Card positions on a battlefield are proportional, and cards are sized from the board's height, so every screen shows the same layout with cards as big as it allows (`ui/fit.ts`).

Two tabs on one machine act as two players, which is handy for testing.

## Credits

Icons by Lorc, Delapouite, Catsu, Faithtoken, Quoting and Sbed from [game-icons.net](https://game-icons.net), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
Card data and images from [Scryfall](https://scryfall.com). Font: [Grenze](https://fonts.google.com/specimen/Grenze).

## Relay (TURN) for strict networks

Players connect directly when they can. Behind strict NATs (corporate, some mobile networks) they need a relay.
Production builds ask `/api/turn` (`api/turn.ts`), a Vercel function that returns short-lived
[Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) credentials. It needs two server-side
environment variables:

- `CLOUDFLARE_TURN_KEY_ID`
- `CLOUDFLARE_TURN_KEY_API_TOKEN`

Without them it answers 503 and connections stay direct. Another provider can be used instead with
`VITE_TURN_CREDENTIALS_URL` (a URL returning an `RTCIceServer[]`) or `VITE_ICE_SERVERS` (JSON).

The top bar shows whether a player is connected `direct` or `via relay`.
