# Series One code rules

Pack One issues one code when the pack is purchased, in the same framework transaction as the sealed cards. Opening, animation, reload and reveal do not reroll it.

| Family | Layout | Rewards |
| --- | --- | --- |
| Standard | 15 characters, displayed as 5–5–5 | Fourteen material/consumable outcomes |
| Pet | C01 + 15 characters | Black Bunny, 30 days |
| Pet | C02 + 15 characters | Blue Husky, 30 days |
| Pet | C03 + 15 characters | Porcupine, 30 days |

The bridge accepts spaces and hyphens for display grouping and normalizes case. Generation uses cryptographically secure random draws and an alphabet excluding ambiguous I, O, 0 and 1. This alphabet is an implementation choice, not a recovered official code-generation algorithm. Codes are valid only on the configured private server.

Each of the seventeen outcomes in [series-one.json](../data/series-one.json) has a uniform 1/17 chance, independently of collectible rarity. Pets expire thirty days after delivery. Consumables retain the table's quantities. Starter Red Relaxer, promotional Maple Champion and later-series rewards are excluded.

Historical Series One reward codes were printed on play cards. The dedicated insert in every digital pack is this edition's adaptation; it is not a claim that original Series One boosters contained a separate code card. Historical layouts and quantities were checked against [the iTCG code reference](https://maplestoryitcg.weebly.com/codes.html).

The game enforces the account, Series One whitelist, quantity and pet-prefix pairing. It stores an HMAC fingerprint rather than plaintext code text. Redeeming a code retains the collectible/code-card record in the library; it changes the verified redemption status.
