// The economy: money earned by kills and round results, spent in the buy menu
// during the buy phase. A survived round keeps the loadout, armour and
// grenades; a death drops everything but the sidearm. Prices and rewards are
// Counter-Strike-shaped: a rifle costs most of a round win, so losing rounds
// hurts, and a loss streak pays a little extra to keep a comeback possible.
import { ECONOMY } from './state.js';
import { WEAPONS } from './weapons.js';

// Shop rows that are weapons read their price straight off the weapon table,
// so a weapon rebalance can never leave the shop charging a stale price.
function weaponRow(key, id, detail) {
  return { key, id, name: WEAPONS[id].name, detail, price: WEAPONS[id].price };
}

export const SHOP = [
  weaponRow('1', 'smg', 'SMG · fast, close range'),
  weaponRow('2', 'rifle', 'Rifle · the all-rounder'),
  weaponRow('3', 'sniper', 'Sniper · one shot, scoped'),
  { key: '4', id: 'grenade', name: 'Frag Grenade', detail: 'Throw with G · max 2', price: 300 },
  { key: '5', id: 'armour', name: 'Kevlar Vest', detail: 'Absorbs half of each hit', price: 650 },
  { key: '6', id: 'ammo', name: 'Ammo Resupply', detail: 'Refills every magazine', price: 200 },
];

const MAX_GRENADES = 2;
const MAX_ARMOUR = 100;
const MAX_LOSS_BONUS_STREAKS = 3;
const GUN_IDS = new Set(['smg', 'rifle', 'sniper']);

export function createEconomy(state, weapons, player) {
  // Loadout a survived round carries into the next one; null means the
  // player died and restarts with the sidearm only.
  let kept = null;

  // Every credit is capped the same way: money can never pass maxMoney, and
  // the cap is applied at the single place money is added, not at each
  // caller, so no reward path can forget it.
  function credit(amount) {
    state.money = Math.min(ECONOMY.maxMoney, state.money + amount);
  }

  // Each rule that can refuse a purchase is one small check returning a
  // reason string, or null when the purchase passes that rule. The buy
  // function runs them in order and reports the first failure, so the player
  // always hears the most relevant reason (a closed shop beats an empty
  // wallet, an empty wallet beats a full grenade pouch).
  function shopClosed() {
    return state.phase !== 'buy' ? 'Buying is open only before the round starts.' : null;
  }

  function tooPoor(item) {
    return state.money < item.price ? 'Not enough money.' : null;
  }

  function pouchFull() {
    return weapons.state.grenades >= MAX_GRENADES ? 'Carrying the maximum of 2 grenades.' : null;
  }

  function vestFull() {
    return player.state.armour >= MAX_ARMOUR ? 'Armour is already full.' : null;
  }

  function alreadyOwned(id) {
    return weapons.owns(id) ? 'Already owned — use Ammo Resupply instead.' : null;
  }

  function refusalFor(id, item) {
    const checks = [shopClosed, () => tooPoor(item)];
    if (id === 'grenade') checks.push(pouchFull);
    else if (id === 'armour') checks.push(vestFull);
    else if (GUN_IDS.has(id)) checks.push(() => alreadyOwned(id));
    for (const check of checks) {
      const reason = check();
      if (reason) return reason;
    }
    return null;
  }

  // Applying a purchase is a dispatch on the item kind: grenades and armour
  // are counters on other modules, ammo refills every owned magazine, and a
  // gun is handed to the weapons module to add to the loadout.
  function applyPurchase(id) {
    if (id === 'grenade') weapons.state.grenades += 1;
    else if (id === 'armour') player.state.armour = MAX_ARMOUR;
    else if (id === 'ammo') weapons.refillAmmo();
    else weapons.buy(id);
  }

  function buy(id) {
    const item = SHOP.find((entry) => entry.id === id);
    if (!item) return { ok: false, reason: 'No such item.' };
    const refusal = refusalFor(id, item);
    if (refusal) return { ok: false, reason: refusal };
    state.money -= item.price;
    applyPurchase(id);
    return { ok: true, reason: `${item.name} bought.` };
  }

  function killReward() {
    credit(ECONOMY.killReward);
  }

  // A win pays the flat win reward and resets the loss streak. A loss pays
  // the loss reward plus a bonus per consecutive loss already suffered,
  // capped at three streaks, and then extends the streak by one.
  function roundReward(winnerTeam) {
    if (winnerTeam === 0) {
      credit(ECONOMY.winReward);
      state.lossStreak = 0;
    } else {
      const streaks = Math.min(MAX_LOSS_BONUS_STREAKS, state.lossStreak);
      credit(ECONOMY.lossReward + streaks * ECONOMY.lossStreakBonus);
      state.lossStreak += 1;
    }
  }

  // Called at the round end: the living keep their kit, the dead lose it.
  // The snapshot is taken now, while the round's loadout still exists,
  // because the next round's reset rebuilds the weapons from scratch.
  function keepLoadout() {
    if (player.state.alive) {
      kept = {
        loadout: weapons.snapshotLoadout(),
        armour: player.state.armour,
        grenades: weapons.state.grenades,
      };
    } else {
      kept = null;
    }
  }

  function restoreLoadout() {
    if (kept) {
      weapons.resetRound(kept.loadout);
      player.state.armour = kept.armour;
      weapons.state.grenades = kept.grenades;
    } else {
      weapons.resetRound(null);
      weapons.state.grenades = 0;
    }
  }

  return { buy, killReward, roundReward, keepLoadout, restoreLoadout };
}
