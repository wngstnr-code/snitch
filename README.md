# SNITCH — Living Compliance Attestations

> **PDF certificates go stale silently. Ours revoke themselves.**

ChainHack 2026 / NeuralLedger 5.0 · Track: **Industrial 5.0** — with AI × Web3 and Real-World Finance

An AI agent challenges an exporter's deforestation claims against evidence they
do not control, a human signs off, and the resulting attestation is written to
Base — where it **revokes itself** the moment new satellite imagery contradicts
it.

---

## It already happened. Here is the receipt.

On 5 August 2026 an attestation was issued, and **162 seconds later it revoked
itself**. Nobody pressed an undo button; the watcher pulled that day's Global
Forest Watch tiles, found 112,625 deforestation alerts dated after the evidence
window the attestation vouched for, and called `revoke()`.

| | |
|---|---|
| Attestation | [`0x3b9429dc…ed2314b2`](https://base-sepolia.easscan.org/attestation/view/0x3b9429dc9d26151f848071b87532b653d9d70b3e1a57a9010cac340aed2314b2) |
| Issued | 09:33:26 UTC — [tx `0x6ea22671…0411867c`](https://sepolia.basescan.org/tx/0x6ea22671b70c371682db28a788dc5408246bb63a3f2e176e38834d510411867c) |
| Revoked | 09:36:08 UTC — [tx `0x0e408058…9c9fb30a`](https://sepolia.basescan.org/tx/0x0e408058b0e08a361b70e00f459be349283e2c4d5e76fc90ee99b16b9c9fb30a) |
| Evidence window | 01 Jan 2023 |
| Reason on record | *112,625 GFW deforestation alerts dated after `evidenceAsOf` 2023-01-01 (tile `v20260804`, z12, 121 tiles). This evidence did not exist when the attestation was issued, and it contradicts it.* |
| Reviewed by | Nabil Aufa — a named human, written permanently to chain |

Check it yourself at `/v/0x3b9429dc9d26151f848071b87532b653d9d70b3e1a57a9010cac340aed2314b2`.
That page never touches our database. It reads the contract, downloads the
evidence bundle from the address recorded *inside* the attestation, re-hashes it,
and compares against the hash anchored onchain. **The answer stays correct even
if our server is wrong, offline, or lying.**

### Six attestations, and the difference between them is the product

Every row below is live on Base Sepolia right now. Three are still standing;
three are dead. Nobody moved them by hand — the watcher decides, every 15
minutes, by re-reading that day's satellite tiles.

| Status | Verdict | Subject | Evidence window | Attestation |
|---|---|---|---|---|
| 🟢 ACTIVE | **PASS** | Miracle Harvest concession (Kwantas) · 233.5 ha, plot-level | 2026-08-07 | [`0x37c2a130…36c9f77e`](https://base-sepolia.easscan.org/attestation/view/0x37c2a1300cb15f6d8bc5fbb2d5757a040a31782e574535aaf8eca21736c9f77e) |
| 🟢 ACTIVE | FAIL | NITAR mill (FGV Palm Industries) · 50 km sourcing radius | 2026-08-05 | [`0xf3c5d6e2…ebb7ffca`](https://base-sepolia.easscan.org/attestation/view/0xf3c5d6e200e73da403bed6e8316c8ce29c8450b9339636a6c1e3f7a1ebb7ffca) |
| 🟢 ACTIVE | FAIL | SEPAKAU POM (Sarawak Oil Palms) · 50 km sourcing radius | 2026-08-05 | [`0xe670398a…1a56ab8c`](https://base-sepolia.easscan.org/attestation/view/0xe670398a073ddc77854dcfcdbcd25a1ed8d02a0634f4dba6f00824851a56ab8c) |
| 🔴 REVOKED | FAIL | WA HA mill (FGV Palm Industries) | 2023-01-01 | [`0x3b9429dc…ed2314b2`](https://base-sepolia.easscan.org/attestation/view/0x3b9429dc9d26151f848071b87532b653d9d70b3e1a57a9010cac340aed2314b2) |
| 🔴 REVOKED | FAIL | WA HA mill | 2026-06-01 | [`0x6ba0f878…6a0dd515`](https://base-sepolia.easscan.org/attestation/view/0x6ba0f8789ed310a325a1bda5a2b9d48a91220f50241100f48542824b6a0dd515) |
| 🔴 REVOKED | FAIL | WA HA mill | 2026-06-01 | [`0xb044b160…cd5458b6`](https://base-sepolia.easscan.org/attestation/view/0xb044b16086beae6f433083f727644c0db5e29e223c3f74c8a2a482fbcd5458b6) |

Read the pattern, because it is the whole thesis:

- **PASS is earned, never assumed.** Miracle Harvest is a real Malaysian
  concession from the WRI dataset that we selected *by measuring*: we decoded
  its tiles and found zero alerts after the EUDR cutoff. Its EU operator, Bunge
  Loders Croklaan B.V., resolves to an active LEI in the Netherlands and clears
  both sanctions lists. Every leg of the claim is independently checkable.
- **FAIL gets published too.** Two mills failed and were signed and published as
  failures. A verification tool that only ever emits good news is marketing.
- **The dead ones died on evidence, not on a schedule.** All three carry an
  evidence window in the past on plots that genuinely kept burning afterwards.
  The watcher found the newer alerts and called `revoke()`.

The three active attestations survived a real watcher pass on the day of
writing — `{"checked":3,"revoked":[],"errors":[]}`. They are not safe forever,
and that is the point: they stay valid exactly as long as the forest does.

---

## The problem

Two EU regulations are already biting Malaysian and Southeast Asian exporters:

- **EUDR** — in force **30 December 2026**. Palm oil, rubber and timber — three
  of Malaysia's largest exports — must ship with plot-level geolocation and
  proof of no deforestation after **31 December 2020**.
- **CBAM** — definitive phase began 1 January 2026. €100/tCO₂e, no cap.

Today's answer is a **static PDF**: signed once, valid twelve months.

> If that plot is cleared next month, the PDF still looks valid until the next
> audit — possibly eleven months later.

That is not sloppy paperwork. It is a structural hole in a regime that demands
continuous assurance but enforces it with an artefact frozen at a single moment.
Certificates rot silently, and nobody finds out until it is too late.

The second problem is cost. Third-party audits run into tens of thousands of
euros per cycle. Smallholders cannot pay it, so they are not made compliant —
they are excluded from the EU market, and the supply chain gets *more* opaque.

---

## What SNITCH does

**It is not a traceability platform.** Existing players follow one pattern:
supplier uploads data → we hash it → we store it on a ledger. Blockchain is a
notary there. If the supplier lies at the input, the ledger faithfully preserves
the lie forever.

SNITCH does not trust the input. It attacks it.

| Stage | What happens | Source |
|---|---|---|
| **1 · Collect** | A plot polygon becomes a list of satellite tiles; their pixels decode into dated deforestation alerts. Entities are screened against registries and sanctions lists. | GFW · GLEIF · OFAC · EU |
| **2 · Challenge** | The agent does not summarise the exporter's claims — it contradicts them. Every finding **must cite an evidence ID that exists in the bundle**; unverifiable citations are rejected and regenerated. | Two independent RSPO datasets set against each other |
| **3 · Decide** | A human approves, rejects, or overrides with a written reason. Their name goes onchain. | Without this step, nothing is ever issued |
| **4 · Watch** | A watcher re-checks the same plot against the newest imagery. A fresh alert after the evidence date triggers `revoke()`. | EAS on Base · `revocable: true` |

### Why this has to be onchain

Revocation must be **publicly observable and uncensorable by the issuer**.

An EU importer holding a reference to an attestation sees the status flip to
REVOKED without an email, without a re-audit, and without trusting SNITCH or the
exporter. It keeps working even if SNITCH the company disappears tomorrow. A
database row we control could not make that promise — and a hash-on-a-ledger
notary would not either.

### Why AI, and where it is *not* allowed

The agent never calls an external API. It reasons only over evidence that
deterministic code already collected, with `generateObject` + zod at
`temperature: 0`. Every `evidenceId` it cites is validated against the bundle in
code; if it invents one, the output is rejected and regenerated, and two
failures produce an honest `INCONCLUSIVE` rather than a confident guess.

That division is the point: **AI accelerates reasoning over evidence, humans
carry accountability.** That is Industrial 5.0 as a working architecture rather
than a slogan.

---

## The rule this project is built on

**No mock data. No mock features. No placeholders.**

Every number on screen comes from a real HTTP response, real decoded pixels, or
a real onchain transaction. Every failed external call surfaces as an honest
error in the UI — never behind fabricated fallback data. "Failed to check" must
never look like "clean", because on a compliance product that is not a display
bug, it is a forged attestation.

Consequences you can see in the code:

- Alert confidence that cannot be determined renders as **"unverified"** with a
  hollow, dashed chart segment — a bar that says *I don't know* instead of
  guessing.
- The lifeline graphic closes its right-hand axis on the evidence `fetchedAt`
  timestamp, not `Date.now()`, so the same dossier always draws the same chart.
- Tile versions are pinned (`v20260804`), never `latest`, so any result can be
  reproduced.
- When Global Forest Watch refuses a tile, the map says so on screen rather than
  leaving a blank area that reads as untouched forest.

---

## Evidence sources — every one of them free and registration-free

| Source | Role | Verified |
|---|---|---|
| **GFW integrated alerts** | Deforestation, decoded pixel by pixel | 200 · re-versioned daily, pinned per run |
| **GLEIF LEI Index** | EU operator legal identity | 200 |
| **OFAC SDN + EU consolidated** | Sanctions screening | 50,249 entries in DB |
| **Universal Mill List + Unilever Palm Oil Mills** | RSPO cross-check, two independent datasets | 500 Malaysian mills seeded |
| **Base Sepolia RPC + EAS GraphQL** | Onchain read/write | 200 |
| **Esri World Imagery** | Basemap | 200 |

This started as risk mitigation. For a trust layer it became an argument:

> SNITCH runs on the same public data the Global Forest Watch map renders in
> your browser, plus open government registries. **Anyone can reproduce our
> verdict independently.** No paid gatekeeper, no vendor who can switch us off.

A trust layer that depends on one commercial API is not a trust layer. It is a
single point of failure wearing a costume.

### The satellite tiles are data, not pictures

GFW alert tiles encode the alert date in the red and green channels
(`day = R × 255 + G` since 2014-12-31) and the **confidence level in the alpha
channel** — which holds only three values: `4`, `8`, `24`, out of 255.

Rendered as an ordinary raster layer that is 1.6–9% opacity: invisible. So the
browser intercepts every tile, decodes it with the same rules the server uses,
and repaints it visibly. Same pixels, same decode, only the opacity changes —
nothing is invented. Alpha values outside those three are **not guessed**; they
are painted neutral and labelled *unverified*.

---

## Stack

Next.js 16 App Router · TypeScript strict, no `any` · Tailwind + shadcn ·
MapLibre GL (token-free) · Neon Postgres + Drizzle · Vercel AI SDK v6 with
**Gemini 3.6 Flash** · **viem** (no ethers) · Vercel Blob · GitHub Actions every
15 minutes as the watcher trigger.

```
EAS            0x4200000000000000000000000000000000000021   (OP-Stack predeploy)
SchemaRegistry 0x4200000000000000000000000000000000000020
Chain          Base Sepolia · 84532   (read from CHAIN_ID; mainnet is one variable away)
```

**Testnet is not a mock.** Base Sepolia has real consensus and real finality;
the attestation and the revocation above are real transactions. Choosing mainnet
would have created the project's only lead-time blocker — wallet funding — and
put real money behind a private key living in an environment variable. A bug in
a watcher that attests and revokes in a loop costs nothing here.

---

## Ecosystem alignment

Each of these is load-bearing. Remove any one and a feature stops working —
none of them is a logo we pasted on a slide.

| Ecosystem | What it actually carries | Where to verify |
|---|---|---|
| **Base** | Every attestation and every revocation. EAS is an OP-Stack predeploy, so `0x42…21` is the same address on Base mainnet and Base Sepolia — moving to mainnet is one environment variable, not a migration. Revocation is the product; it needed a chain where `revocable: true` is native rather than re-implemented. | 6 attestations, 3 revocations, all onchain above |
| **Ethereum Attestation Service** | The schema itself: verdict, confidence, evidence hash, evidence URI, evidence window, reviewer, LEI. Anchoring the bundle hash onchain is what lets `/v/[uid]` re-verify without trusting our server. | Schema `0x9e8b55ac…1e2c9c25` |
| **Google Gemini** | The contradiction agent, through the Vercel AI SDK — structured output with zod at `temperature: 0`, cited findings only, invented citations rejected in code. | `lib/agent/` |
| **Vercel** | App, Functions running the 300-second verification job, and Blob holding every evidence bundle at the URI recorded inside the attestation. | `snitch-lyart.vercel.app` |
| **Neon** | Postgres behind Drizzle: plots, verifications, evidence, the append-only review log, 50k sanctions entries, and the watch-run history that proves monitoring happened. | `npm run db:check` |

The evidence layer deliberately belongs to nobody: Global Forest Watch, GLEIF,
OFAC, the EU sanctions list and ArcGIS Hub are all free and registration-free.
That is not thrift. A trust layer whose evidence can be switched off by one
vendor is not a trust layer.

---

## Run it

```bash
npm install
cp .env.example .env      # then fill in the values
npm run db:migrate
npm run sanctions:sync    # OFAC + EU, ~50k entries
npm run mills:seed        # real mills from ArcGIS
npm run dev
```

Checks:

```bash
npm run build && npm run typecheck && npm run lint
npm test                  # 89 tests — sends real Base Sepolia transactions
npm run services:check    # AI + Blob
npm run db:check && npm run chain:check
```

| Variable | For | Required |
|---|---|---|
| `DATABASE_URL` | Neon Postgres | yes |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Contradiction agent | yes |
| `BLOB_READ_WRITE_TOKEN` | Evidence bundle storage | yes |
| `ATTESTER_PRIVATE_KEY` | Attestation signer | yes |
| `CHAIN_ID` | `84532` Base Sepolia · `8453` mainnet | yes |
| `EAS_SCHEMA_UID` | SNITCH schema (pre-filled) | yes |
| `CRON_SECRET` | Watcher endpoint guard | in deployment |

New wallet: `npm run wallet:new`, then a Base Sepolia faucet.

### Where to look

| Route | What it shows |
|---|---|
| `/` | Every verification run so far |
| `/new` | Pick a real Malaysian mill from the map, or upload a plot GeoJSON |
| `/verifications/[id]` | The dossier: lifeline, evidence, agent findings, human review, onchain state |
| `/v/[uid]` | Public verification — no account, read straight from chain |

The signature graphic is the **lifeline**: one time axis from the EUDR cutoff to
the date evidence was last pulled. Solid blue is what the attestation actually
vouches for; the dashed remainder is monitored but uncovered. When a revocation
lands, the line stops there and the certificate visibly dies.

That break is drawn from the onchain revocation, **not** from the evidence
bundle — deliberately. The alerts that kill an attestation usually did not exist
when it was issued, so deriving the break from the bundle would draw an intact
line straight through a dead attestation: the exact failure this product exists
to prevent.

---

## Limitations we state up front

- **Not a certification body.** Verdicts here are indicative and do not replace
  an official EUDR Due Diligence Statement. The disclaimer is on every screen.
- **Mill sourcing-radius analysis is not plot-level verification.** A mill is a
  point; what gets analysed is the 50 km sourcing radius around it — standard
  palm oil industry methodology, but a different claim. The UI never blurs the
  two.
- **Real supplier plot polygons are private**, so the demo uses public mill
  datasets and user-uploaded GeoJSON.
- **GFW covers the tropics.** Outside roughly 32°N–32°S its tile server returns
  errors rather than empty tiles; the map reports that instead of showing blank.
- **The signer key lives in an environment variable.** Inadequate for a real
  product; KMS or multisig is roadmap.
- **No TRACES/DDS integration** and **no appeal mechanism** for an exporter who
  disputes a verdict. Both roadmap.
- **Sanctions screening is fuzzy name matching** against lists refreshed daily;
  it throws rather than returning "clean" if the lists are older than 30 days.

---

## Attribution

Deforestation alerts from [Global Forest Watch](https://www.globalforestwatch.org/)
integrated alerts (GLAD-L, GLAD-S2, RADD, DIST-ALERT), © World Resources
Institute, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

GLEIF Global LEI Index · OFAC Specially Designated Nationals List · EU
Consolidated Financial Sanctions List · Universal Mill List and Unilever Palm
Oil Mills (ArcGIS Hub) · Esri World Imagery · OpenStreetMap contributors.

MapLibre GL JS worker files in `public/maplibre/` are copied verbatim from the
`maplibre-gl` package — see `SOURCE.txt` there for why.

---

## Licence

Source code: MIT — see [`LICENSE`](LICENSE).

The MIT grant covers our code only; it does not relicense the data above. GFW
alerts stay CC BY 4.0 with mandatory attribution, and the ArcGIS concession
layer is a third-party re-upload of unclear licensing, which is why
user-uploaded GeoJSON remains the primary path rather than a convenience we
built the product around.
