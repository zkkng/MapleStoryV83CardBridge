# Using the card website

The included website is a standalone collector interface for the pinned Cosmic v83 deployment. Open `/library/` on your configured bridge origin. Its layout, card backs and pack illustrations use original CSS and system fonts; no game artwork is bundled.

## Browse or sign in

Visitors can browse available packs, inspect their contents and preview the card catalog. Sign in with an existing account on your game server to buy and collect. Account creation and funding belong to the game server; the card website does not create a separate wallet or account.

NX Credit, Maple Points and NX Prepaid appear in the sticky header while signed in. Select the balance you want to spend in the purchase panel. Its available amount and the balance after purchase also appear in the confirmation window. During an outage, cached balances are marked stale and purchases pause.

## Buy and open

Choose a pack, select a balance and quantity, then review the confirmation. The contents view explains draw weights or per-draw chances where applicable. Draws are random and duplicates are possible. Packs are collectibles only unless the offer explicitly includes reward codes.

After buying, open a pack under **Unopened packs**. The results move into view and mark newly collected variants. Select **Done** or **View collection** to dismiss them. There is no opened-pack archive: opened packs become cards in your collection. Interrupting the visual reveal does not reroll a committed result.

If a response is lost, use **Check purchase**. The browser retains the original request in session storage and retries that purchase; a rate-limit response does not replace its identity. Leave this tab open while resolving an interrupted purchase. If recovery remains pending, contact the server operator with the time and account name.

## Browse your collection

Search card names, filter by set or rarity, and sort by name, rarity or copies owned. Choose **My cards**, **All cards in the catalog**, **Cards I’m missing** or **My duplicates**. Select a set completion meter to browse that entire set. **Clear filters** restores the default owned-card view and name sorting.

Duplicates are counted together. Selecting a card opens its image, rarity, description and owned count. **Show more cards** expands the visible grid. Card images preserve their portrait proportions. Missing external images show a placeholder without changing ownership.

## Optional rewards and scans

The default Shapes pack has no code insert, no item pool and no reward section. Operators may explicitly enable the [Series One campaign](code-rules.md). Reward codes appear after an eligible pack is opened; reveal and copy them for the in-game Cash Shop. Code text is cleared when signing out and is never saved in purchase recovery storage.

The [optional iTCG importer](itcg-import.md) builds separate set packs whose images load directly from the named source website. Importing scans does not enable rewards or copy artwork into the website. Remote artwork remains third-party material and its availability depends on the source.

## Administration and rollout

Separately granted website administrators can create and manage cards and packs, preview drafts, publish and review purchases. Game GM status alone does not grant website administration. See [administration](administration.md).

The website supports keyboard controls, mobile layouts, focus restoration in dialogs and reduced motion. Sign out before sharing a device. Before accepting player purchases, follow the [deployment rollout checks](operations.md#rollout-checklist) and current [compatibility limits](compatibility.md); a functional interface alone does not establish production payment or throughput qualification.
